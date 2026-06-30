#define AppName "Stackarr"
#ifndef AppVersion
#define AppVersion "0.0.0-dev"
#endif
#ifndef Runtime
#define Runtime "win-x64"
#endif

[Setup]
AppId={{77CF9F0C-76B5-4B5B-9F29-9D3292E8D5C1}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Polyphonic
AppPublisherURL=https://github.com/b-bot/Stackarr
AppSupportURL=https://github.com/b-bot/Stackarr/issues
AppUpdatesURL=https://github.com/b-bot/Stackarr/releases
DefaultDirName={commonappdata}\Stackarr\bin
DefaultGroupName=Stackarr
DisableProgramGroupPage=yes
OutputDir=..\dist
OutputBaseFilename=Stackarr-{#Runtime}-{#AppVersion}-installer
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"
Name: "startupshortcut"; Description: "Start Stackarr when this user signs in"; GroupDescription: "Shortcuts:"

[Files]
Source: "..\Stackarr\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Stackarr"; Filename: "{app}\Stackarr.cmd"
Name: "{autodesktop}\Stackarr"; Filename: "{app}\Stackarr.cmd"; Tasks: desktopicon
Name: "{userstartup}\Stackarr"; Filename: "{app}\Stackarr.cmd"; Tasks: startupshortcut

[Run]
Filename: "{app}\Stackarr.cmd"; Description: "Launch Stackarr"; Flags: nowait postinstall skipifsilent
