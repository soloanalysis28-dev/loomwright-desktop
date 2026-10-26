fn main() {
    println!("cargo:rerun-if-changed=../installer/app.ico");

    #[cfg(windows)]
    {
        let mut resource = winres::WindowsResource::new();
        resource.set_icon("../installer/app.ico");
        resource.set("FileDescription", "Loomwright");
        resource.set("ProductName", "Loomwright");
        resource.set("FileVersion", "3.0.0.0");
        resource.set("ProductVersion", "3.0.0.0");
        resource.set("LegalCopyright", "Copyright (C) 2026 Loomwright");
        if let Err(error) = resource.compile() {
            println!("cargo:warning=windows resource not embedded: {error}");
        }
    }
}
