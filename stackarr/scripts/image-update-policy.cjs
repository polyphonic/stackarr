'use strict';
// Evidence is release-keyed; absent ranges are unknown, never invented from a tag.
const ENGINES = new Set(['postgresql', 'mariadb', 'redis']);
const ENGINE_SERVICES = new Set(['database', 'redis', 'youtarr-db', 'romm-db']);
const version = (v) => typeof v === 'string' && /^\d+(?:\.\d+){1,3}$/.test(v);
const compare = (a, b) => {
  const x = a.split('.').map(Number),
    y = b.split('.').map(Number);
  if (![...x, ...y].every(Number.isSafeInteger)) return null;
  for (let i = 0; i < Math.max(x.length, y.length); i++)
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0) ? -1 : 1;
  return 0;
};
const rangeValid = (r) =>
  r && version(r.min) && version(r.max) && compare(r.min, r.max) !== null && compare(r.min, r.max) <= 0;
const within = (v, r) => version(v) && rangeValid(r) && compare(v, r.min) >= 0 && compare(v, r.max) <= 0;
const tag = (ref) => typeof ref === 'string' && /:([^/@]+)(?:@sha256:[a-f0-9]{64})?$/.exec(ref)?.[1];
const risk = (from, to) =>
  !version(from) || !version(to)
    ? 'non-semver'
    : from.split('.')[0] !== to.split('.')[0]
      ? 'major'
      : from.split('.')[1] !== to.split('.')[1]
        ? 'minor'
        : 'patch';
const hold = (reason) => ({ decision: 'HOLD', reason });
function evaluateImageUpdate({
  service,
  current,
  candidate,
  release,
  readings = {},
  dependencies,
  update = false
} = {}) {
  if (typeof service !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(service)) return hold('Invalid service');
  if (typeof candidate?.reference !== 'string' || !candidate.reference.trim()) return hold('Missing candidate image');
  if (
    release?.image === candidate.reference &&
    (release.incompatible === true || release.requiresEngineChange === true)
  )
    return hold('Known incompatible release or required engine transition; plan dependency change manually');
  if (
    current?.reference === candidate.reference &&
    !release &&
    !update &&
    (!current.imageId || !candidate.imageId || current.imageId === candidate.imageId)
  )
    return { decision: 'UNCHANGED', reason: 'Same configured image; recovery needs no enrollment' };
  if (ENGINE_SERVICES.has(service) && current?.reference && current.reference !== candidate.reference)
    return hold('Database/cache engine image changes require a separate manual migration');
  if (!current?.reference) return { decision: 'ALLOW', reason: 'Initial installation' };
  const warnings = [];
  const transitionRisk = risk(tag(current.reference), tag(candidate.reference));
  if (['major', 'non-semver'].includes(transitionRisk) && !release?.assessment)
    warnings.push(`${transitionRisk} transition: assess upstream release notes and schema rollback requirements`);
  if (!release) warnings.push('No release compatibility evidence recorded; dependency ranges unknown');
  else if (release.image !== candidate.reference)
    warnings.push('Release image identity differs from candidate; ranges unverified');
  else {
    if (release.previous && release.previous !== current.reference)
      warnings.push('Previous rollback identity differs from running image');
    if (release.incompatible === true || release.requiresEngineChange === true)
      return hold('Known incompatible release or required engine transition; plan dependency change manually');
    for (const issue of release.incompatibilities || []) {
      if (!ENGINES.has(issue.engine)) continue;
      const reading = readings[issue.engine];
      if (!reading)
        return hold(
          `Cannot exclude documented ${issue.engine} incompatibility; verify selected endpoint before update`
        );
      if (reading && (!issue.version || within(reading.version, issue.version)))
        return hold(`Known ${issue.engine} incompatibility: ${issue.reason || 'release advisory'}`);
    }
    if (!Array.isArray(release.requirements)) warnings.push('Supported dependency ranges undocumented');
    else
      for (const req of release.requirements) {
        if (!ENGINES.has(req.engine)) return hold('Invalid engine requirement in release evidence');
        if (!rangeValid(req.version)) {
          warnings.push(`${req.engine} supported range undocumented`);
          continue;
        }
        const reading = readings[req.engine];
        if (!reading || !version(reading.version)) {
          warnings.push(`${req.engine} version unavailable; documented range unverified`);
          continue;
        }
        if (!within(reading.version, req.version))
          return hold(
            `${req.engine} ${reading.version} outside documented supported range ${req.version.min}–${req.version.max}; manual dependency change required`
          );
        for (const ext of req.extensions || []) {
          if (!rangeValid(ext.version)) {
            warnings.push(`${req.engine} extension ${ext.name} range undocumented`);
            continue;
          }
          const installed = reading.extensions?.find((e) => e.name === ext.name);
          if (!installed || !within(installed.version, ext.version))
            return hold(`${req.engine} extension ${ext.name} missing or outside documented supported range`);
        }
      }
  }
  if (dependencies === null) warnings.push('Configured dependency inventory unavailable');
  if (release?.evidence && !release.evidence.citation) warnings.push('Release evidence lacks citation');
  return { decision: 'ALLOW', reason: `Application image update (${transitionRisk})`, warnings };
}
module.exports = { evaluateImageUpdate };
