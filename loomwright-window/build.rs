fn main() {
    println!("cargo:rerun-if-changed=../installer/app.ico");
    println!("cargo:rerun-if-env-changed=LOOMWRIGHT_DISPLAY_VERSION");

    #[cfg(windows)]
    {
        let display_version = std::env::var("LOOMWRIGHT_DISPLAY_VERSION")
            .unwrap_or_else(|_| "1.6.0.4".to_string());
        let file_version = windows_file_version(&display_version);
        let mut resource = winres::WindowsResource::new();
        resource.set_icon("../installer/app.ico");
        resource.set("FileDescription", "Loomwright");
        resource.set("ProductName", "Loomwright");
        resource.set("FileVersion", &file_version);
        resource.set("ProductVersion", &file_version);
        resource.set("LegalCopyright", "Copyright (C) 2026 Loomwright");
        if let Err(error) = resource.compile() {
            println!("cargo:warning=windows resource not embedded: {error}");
        }
    }
}

#[cfg(windows)]
fn windows_file_version(display_version: &str) -> String {
    let parts: Vec<u32> = display_version
        .split('.')
        .map(|part| part.parse().expect("display version parts must be numeric"))
        .collect();
    match parts.as_slice() {
        [major, minor, patch, revision] => {
            if *major > 255 || *minor > 255 || *patch > u16::MAX as u32 || *revision > u16::MAX as u32 {
                panic!("display version cannot be represented as a Windows file version");
            }
            format!("{major}.{minor}.{patch}.{revision}")
        }
        [major, minor, patch, revision, micro] => {
            // Preserve compatibility with previously published five-part versions.
            let file_revision = revision
                .checked_mul(1000)
                .and_then(|value| value.checked_add(*micro))
                .filter(|value| *value <= u16::MAX as u32)
                .expect("display version cannot be represented as a Windows file version");
            format!("{major}.{minor}.{patch}.{file_revision}")
        }
        _ => panic!("display version must have four or five numeric parts"),
    }
}
