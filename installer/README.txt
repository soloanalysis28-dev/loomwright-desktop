Loomwright 1.6
==============

A writing desk for books, characters and story threads. This build ships the
original Loomwright interface inside a native Windows application: the window,
the local service and the installer are Rust; the interface is rendered by the
WebView2 engine that is part of Windows 10 and 11.

Getting started
---------------
1. Launch Loomwright from the Start menu.
2. Your library is empty — ready for your first real project. Click
   "New project", give it a name, and start writing.
3. Chapters live in the left rail. Formatting uses the toolbar, or a small
   Markdown subset: **bold**, *italic*, # heading, > quote, - bullet.

Where your work is stored
-------------------------
Projects:   %LOCALAPPDATA%\Loomwright\WebView2  (the app's browser profile)
Shared:     %APPDATA%\Loomwright\shared.json    (cross-window project sync)

Use Settings > Offline & storage for the exact paths, or Finalise > Export for
a plain-text, Markdown or print-ready HTML copy. Exports go to:

   %USERPROFILE%\Documents\Loomwright

Uninstalling
------------
Use Settings > Apps > Installed apps, or the "Uninstall Loomwright" shortcut in
the Start menu folder. Uninstalling removes the application only; the folders
above are deliberately left in place.

Keyboard shortcuts
------------------
Ctrl+S        Save now
Ctrl+N        New chapter
Ctrl+Shift+Z  Focus mode
Esc           Leave focus mode / close a dialog

Version 1.6.0 - built for Windows 10 and 11 (x64)
