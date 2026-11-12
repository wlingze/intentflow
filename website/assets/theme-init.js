/* Applied before the stylesheets so the first paint has no theme flash.
   Order of precedence: saved choice, then the operating system preference. */
(function () {
  var theme = 'dark';
  try {
    var stored = localStorage.getItem('intentflow.theme');
    if (stored === 'light' || stored === 'dark') {
      theme = stored;
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      theme = 'light';
    }
  } catch (_) {
    /* Storage can be unavailable in restricted contexts; dark is the fallback. */
  }
  document.documentElement.setAttribute('data-theme', theme);
})();