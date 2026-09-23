/**
 * Injected into a public page when it's opened from the dashboard's "Preview" / "View live" link
 * with ?cms-edit=1 while signed in as an admin/editor. It does not do inline click-to-edit (that
 * lives in the dashboard's Content editor, which has full validation and an undo/reset per field) —
 * it just makes clear this is a preview and gives a one-click way back to editing this exact page.
 */
(function () {
  'use strict';
  if (window.top !== window.self) return; // don't double-inject inside an iframe
  var page = document.body.getAttribute('data-cms-page');
  var bar = document.createElement('div');
  bar.setAttribute('style', 'position:fixed;left:0;right:0;top:0;z-index:99999;background:#161B22;color:#fff;font:600 13px -apple-system,Segoe UI,Roboto,sans-serif;display:flex;align-items:center;gap:12px;padding:9px 16px;box-shadow:0 2px 10px rgba(0,0,0,0.25);');
  bar.innerHTML =
    '<span style="opacity:.85;">&#128065; Previewing as ' + (page ? '"' + page + '"' : 'this page') + ' &mdash; visitors do not see this bar.</span>' +
    '<span style="flex:1;"></span>' +
    '<a id="cms-edit-link" href="/admin#' + (page || 'dashboard') + '" style="color:#fff;background:#E8672B;padding:6px 12px;border-radius:7px;text-decoration:none;">Edit this page</a>' +
    '<a href="?" style="color:#fff;opacity:.85;text-decoration:none;">Exit preview</a>';
  document.body.insertBefore(bar, document.body.firstChild);
  document.body.style.paddingTop = bar.offsetHeight + 'px';
})();
