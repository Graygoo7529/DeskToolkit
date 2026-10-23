# Read the real application's accessibility tree. No vault or clipboard changes.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$smokeExecutable = (Resolve-Path 'src-tauri/target/release/twofauth.exe').Path
$smokeOutput = Join-Path (Get-Location).Path 'test-results/native'
New-Item -ItemType Directory -Force $smokeOutput | Out-Null
$smokeOldFolder = $env:WEBVIEW2_USER_DATA_FOLDER
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $smokeOutput ([Guid]::NewGuid().ToString())
$smokeProcess = Start-Process -FilePath $smokeExecutable -WindowStyle Hidden -PassThru
try {
    $smokeNames = @()
    for ($smokeAttempt = 0; $smokeAttempt -lt 60; $smokeAttempt++) {
        $smokeProcess.Refresh()
        if ($smokeProcess.HasExited) { throw "Application exited: $($smokeProcess.ExitCode)" }
        if ($smokeProcess.MainWindowHandle -ne [IntPtr]::Zero) {
            $smokeRoot = [System.Windows.Automation.AutomationElement]::FromHandle($smokeProcess.MainWindowHandle)
            $smokeElements = $smokeRoot.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
            $smokeNames = @($smokeElements | ForEach-Object { $_.Current.Name })
            if ($smokeNames -contains '选择数据目录' -or $smokeNames -contains '添加认证账户') { break }
        }
        Start-Sleep -Milliseconds 250
    }
    if ($smokeNames -notcontains '选择数据目录' -and $smokeNames -notcontains '添加认证账户') { throw 'Native frontend did not reach its loaded state.' }
    $smokeTimeButton = $smokeRoot.FindFirst([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, '时间校准'))
    if ($null -eq $smokeTimeButton) { throw 'Time settings entry is missing.' }
    $smokeTimeButton.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
    for ($smokeAttempt = 0; $smokeAttempt -lt 40; $smokeAttempt++) {
        $smokeElements = $smokeRoot.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
        $smokeNames = @($smokeElements | ForEach-Object { $_.Current.Name })
        if (($smokeNames -contains '联网校时') -and (($smokeNames -contains '本地系统时间') -or ($smokeNames -contains '网络校正时间'))) { break }
        Start-Sleep -Milliseconds 250
    }
    if ($smokeNames -notcontains '联网校时' -or $smokeNames -contains '时间状态未就绪') { throw 'Native time settings did not load.' }
    'PASS: real desktop window, bundled frontend, Rust state/time IPC, loaded time settings panel. No settings, vault or clipboard changes.'
} finally {
    if (-not $smokeProcess.HasExited) { Stop-Process -Id $smokeProcess.Id }
    $env:WEBVIEW2_USER_DATA_FOLDER = $smokeOldFolder
}
