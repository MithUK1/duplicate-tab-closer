// All help wording for the extension lives here, so it can be read and changed in one place.
// Loaded before the page script on the settings page, the popup and the history page.

const README_URL = "https://github.com/MithUK1/duplicate-tab-closer#readme";

// Short explanations shown under a section heading when its ? button is clicked.
// Each entry is a [term, explanation] pair.
const HELP = {
  toolbar: [
    ["Toolbar click", "What happens when you click the extension's icon: close every duplicate, close only copies of the tab you are on, or open the menu with reopen and history."],
    ["Ask before closing", "Shows how many tabs a click would close, so you can cancel. It has no effect when the click opens the menu."],
    ["Count on the icon", "A small number on the icon showing how many tabs a click would close right now. It disappears when there are none."],
  ],
  behaviour: [
    ["Auto-close", "When the tab in front of you loads a page that is already open, it closes and you are taken to the tab you already had. Links opened in the background are never closed this way."],
    ["Check all windows", "Looks for copies in every window. When off, a tab only counts as a duplicate of tabs in the same window."],
    ["Tabs you duplicate", "Right-click > Duplicate makes a copy on purpose, so it is left alone unless you switch this on."],
    ["Which one closes", "When closing in bulk, the setting picks which copy goes. Pinned tabs are always kept, and a reopened tab goes back to where it was."],
  ],
  matching: [
    ["Same page", "Two tabs match when their web addresses are the same after these rules. Normal and private tabs never match each other."],
    ["#fragment", "The part after # usually points to a spot on the same page, so it is ignored by default."],
    ["?query", "The part after ? often picks the content, such as which video plays, so it counts by default."],
  ],
  sites: [
    ["Never touch", "Tabs on these sites are never closed or counted, for example a mail or chat site you keep open twice on purpose. Put one site per line. Subdomains are included."],
  ],
  history: [
    ["Closed tab history", "A list of tabs that were closed, so you can reopen them. Duplicates closed by the extension are always listed. Your own closes are added only if you choose."],
    ["Keeping it", "Normally the list lives in memory and is wiped when the browser closes. Keeping it saves addresses and titles in your browser profile until they expire or you clear them."],
    ["Forget after", "Entries older than this many minutes are removed for good. 0 keeps them until you clear the list."],
  ],
};

// Fills the small "vX.Y.Z - MUK1" label in the bottom left corner from the manifest version.
function showVersion() {
  const el = document.getElementById("version");
  const api = globalThis.browser ?? globalThis.chrome;
  if (el) el.textContent = `v${api.runtime.getManifest().version} - MUK1`;
}
