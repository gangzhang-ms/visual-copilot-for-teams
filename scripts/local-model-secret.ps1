Set-StrictMode -Version Latest

function Set-PrivateDirectory([string] $Path) {
    if (-not [System.IO.Directory]::Exists($Path)) { [void][System.IO.Directory]::CreateDirectory($Path) }
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = [System.Security.AccessControl.DirectorySecurity]::new()
    $acl.SetOwner($identity)
    $acl.SetAccessRuleProtection($true, $false)
    $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
        $identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
    # Persist only modified owner/access rules, without requesting audit-policy privileges.
    [System.IO.FileSystemAclExtensions]::SetAccessControl([System.IO.DirectoryInfo]::new($Path), $acl)
}

function Save-LocalModelSecret([string] $Path, [string] $Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { throw 'local-credential-empty' }
    $directory = [System.IO.Path]::GetDirectoryName($Path)
    Set-PrivateDirectory $directory
    $secure = ConvertTo-SecureString -String $Value -AsPlainText -Force
    try {
        # No -Key: Windows CurrentUser DPAPI, not portable encryption or plaintext.
        $cipher = ConvertFrom-SecureString -SecureString $secure -ErrorAction Stop
        [System.IO.File]::WriteAllText($Path, $cipher)
        $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
        $acl = [System.Security.AccessControl.FileSecurity]::new()
        $acl.SetOwner($identity)
        $acl.SetAccessRuleProtection($true, $false)
        $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'Allow'))
        [System.IO.FileSystemAclExtensions]::SetAccessControl([System.IO.FileInfo]::new($Path), $acl)
    } finally { $secure.Dispose(); $cipher = $null }
}

function Read-LocalModelSecret([string] $Path) {
    $secure = $null
    $pointer = [IntPtr]::Zero
    try {
        $secure = ConvertTo-SecureString -String ([System.IO.File]::ReadAllText($Path)) -ErrorAction Stop
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
        if ([string]::IsNullOrWhiteSpace($value)) { throw 'empty' }
        return $value
    } catch { throw 'local-credential-unavailable-or-unreadable' }
    finally {
        if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
        if ($null -ne $secure) { $secure.Dispose() }
    }
}
