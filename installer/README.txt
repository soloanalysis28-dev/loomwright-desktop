Loomwright 1.6.0.4.5
==============

A writing desk for books, characters and story threads. This build ships the
original Loomwright interface inside a native Windows application: the window,
the local service and the installer are Rust; the interface is rendered by the
WebView2 engine that is part of Windows 10 and 11.

Getting started
---------------
1. Launch Loomwright from the Start menu.
2. Your library starts empty, with no sample books or chapters. Create a
   project when you are ready; it also starts with no chapters.
3. Add a chapter or import your own manuscript from the Writing desk. First-use
   guides introduce Projects, Writing, Metrics, Characters, Story Web and
   Finalise, then disappear after you use each feature.
   When splitting a full manuscript, contents-page entries and preliminary
   pages are skipped so chapters start at their actual headings.
4. Format text with the Writing toolbar, or use a small Markdown subset:
   **bold**, *italic*, # heading, > quote, - bullet.
5. To use Veritas, install Ollama and a model, then enable Veritas in
   Settings > Veritas. Chapter chat history and chapter memory remain specific
   to the active chapter. Story memory is shared across the project, and the
   Write sidebar lets you link up to five chapters for continuity context.
   Metrics, Characters and Story Web have separate project conversations with
   optional view context. Veritas never edits the manuscript unless you insert
   a reply.

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

Veritas and privacy
-------------------
Veritas sends your chat and any context you choose to include to Ollama.
Local models run on this device; Ollama Cloud models may process requests
outside it. Loomwright has no telemetry.

Keyboard shortcuts
------------------
Ctrl+S        Save now
Ctrl+N        New chapter
Ctrl+Shift+Z  Focus mode
Esc           Leave focus mode / close a dialog

Version 1.6.0.4.5 - built for Windows 10 and 11 (x64)
