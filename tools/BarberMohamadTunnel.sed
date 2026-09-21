[Version]
Class=IEXPRESS
SEDVersion=3

[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=1
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=%InstallPrompt%
DisplayLicense=%DisplayLicense%
FinishMessage=%FinishMessage%
TargetName=%TargetName%
FriendlyName=%FriendlyName%
AppLaunched=%AppLaunched%
PostInstallCmd=%PostInstallCmd%
AdminQuietInstCmd=%AppLaunched%
UserQuietInstCmd=%AppLaunched%
SourceFiles=SourceFiles

[Strings]
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=C:\Users\AsusIran\OneDrive\Desktop\Barber\BarberMohamadTunnel.exe
FriendlyName=Barber Mohamad Public Tunnel
AppLaunched=BarberMohamadTunnel.cmd
PostInstallCmd=<None>
FILE0=BarberMohamadTunnel.cmd
FILE1=Start-BarberTunnel.ps1
FILE2=cloudflared.exe

[SourceFiles]
SourceFiles0=C:\Users\AsusIran\OneDrive\Desktop\Barber\tools\

[SourceFiles0]
%FILE0%=
%FILE1%=
%FILE2%=
