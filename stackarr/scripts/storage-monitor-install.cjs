#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { inspectVolume } = require('./storage-policy.cjs');

function xml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
function unit(value) {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%')}"`;
}
function render(platform, node, script, policy, logDir, docker = '/usr/local/bin/docker') {
  for (const value of [node, script, policy, logDir, docker]) {
    if (!path.isAbsolute(value) || /[\r\n\0]/.test(value)) throw new Error('Invalid monitor path');
    if (value.startsWith('/Volumes/') || value.startsWith('/opt/homebrew/') || value.includes('/Cellar/'))
      throw new Error('Monitor runtime and control state must remain on internal, non-Homebrew storage');
  }
  if (platform === 'darwin')
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.stackarr.storage</string>
<key>ProgramArguments</key><array>${[node, script, 'watch', policy].map((s) => `<string>${xml(s)}</string>`).join('')}</array>
<key>EnvironmentVariables</key><dict><key>STACKARR_STORAGE_DOCKER</key><string>${xml(docker)}</string><key>PATH</key><string>${xml(`${path.dirname(node)}:${path.dirname(docker)}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${os.homedir()}/.local/bin`)}</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>${xml(path.join(logDir, 'storage-monitor.log'))}</string>
<key>StandardErrorPath</key><string>${xml(path.join(logDir, 'storage-monitor.log'))}</string>
</dict></plist>\n`;
  if (platform === 'linux')
    return `[Unit]\nDescription=Stackarr external storage monitor\n\n[Service]\nType=simple\nEnvironment=${unit(`STACKARR_STORAGE_DOCKER=${docker}`)}\nExecStart=:${[node, script, 'watch', policy].map(unit).join(' ')}\nRestart=always\nRestartSec=10\n\n[Install]\nWantedBy=default.target\n`;
  throw new Error('Automatic monitor install supports macOS and Linux user services only');
}
function internalPaths(paths, inspect = inspectVolume, platform = process.platform) {
  const system = inspect(platform === 'darwin' ? '/System/Volumes/Data' : '/');
  for (const file of paths) {
    const real = fs.realpathSync(file);
    if (inspect(real).uuid !== system.uuid)
      throw new Error('Monitor dependencies and control state must remain on the operating-system volume');
  }
}
function dockerExecutable() {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!path.isAbsolute(dir)) continue;
    const file = path.join(dir, 'docker');
    try {
      fs.accessSync(file, fs.constants.X_OK);
      // OrbStack's multi-call binary dispatches on argv[0]. Validate its real
      // location separately, but invoke the executable through its docker name.
      return file;
    } catch {
      /* Next PATH entry. */
    }
  }
  throw new Error('Docker CLI is unavailable');
}
module.exports = { render, internalPaths, dockerExecutable };
if (require.main === module) {
  try {
    const [bin, policy] = process.argv.slice(2);
    const script = fs.realpathSync(path.resolve(path.dirname(bin), '../scripts/storage-control.cjs'));
    const logDir = path.join(path.dirname(policy), 'storage-logs');
    // Pin the actual executable, not an ambient PATH entry that can disappear with a package manager.
    const node = fs.realpathSync(process.execPath);
    const docker = dockerExecutable();
    internalPaths([node, script, policy, path.dirname(policy), docker]);
    execFileSync(docker, ['version', '--format', '{{.Client.Version}}'], { stdio: 'pipe', timeout: 15000 });
    const text = render(process.platform, node, script, policy, logDir, docker);
    fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });
    if (process.platform === 'darwin') {
      const dir = path.join(os.homedir(), 'Library/LaunchAgents');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'com.stackarr.storage.plist');
      fs.writeFileSync(file, text, { mode: 0o600 });
      execFileSync('plutil', ['-lint', file], { stdio: 'pipe' });
      const domain = `gui/${process.getuid()}`;
      try {
        execFileSync('launchctl', ['bootout', domain, file], { stdio: 'pipe' });
      } catch {
        /* First install. */
      }
      execFileSync('launchctl', ['bootstrap', domain, file], { stdio: 'pipe' });
      execFileSync('launchctl', ['print', `${domain}/com.stackarr.storage`], { stdio: 'pipe' });
    } else {
      const dir = path.join(os.homedir(), '.config/systemd/user');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'stackarr-storage.service'), text, { mode: 0o600 });
      execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'pipe' });
      execFileSync('systemctl', ['--user', 'enable', '--now', 'stackarr-storage.service'], { stdio: 'pipe' });
      execFileSync('systemctl', ['--user', 'is-active', 'stackarr-storage.service'], { stdio: 'pipe' });
    }
    console.log('Internal storage monitor installed. Run stackarr storage check before starting the stack.');
  } catch (error) {
    console.error(`Storage monitor installation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
