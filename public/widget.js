(function () {
  if (window.__blogAgentLoaded) return;

  var script = document.currentScript || document.querySelector('script[src*="/widget.js"]');
  if (!script || !script.src) return;
  var ORIGIN = new URL(script.src).origin;

  window.__blogAgentLoaded = true;
  var OPEN_KEY = "blog-agent:open";

  var css =
    ".ba-fab{position:fixed;right:16px;bottom:16px;z-index:1000;width:52px;height:52px;border-radius:50%;border:0;" +
    "background:#1a1a1a;color:#fff;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center}" +
    ".ba-fab:hover{background:#ef402f}.ba-fab:focus-visible{outline:2px solid #ef402f;outline-offset:3px}" +
    ".ba-fab svg{width:24px;height:24px}" +
    ".ba-panel{position:fixed;right:16px;bottom:80px;z-index:1000;width:400px;height:600px;max-height:calc(100vh - 100px);" +
    "background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.25)}" +
    ".ba-panel[hidden]{display:none}.ba-panel iframe{width:100%;height:100%;border:0;display:block}" +
    "@media (max-width:768px){.ba-panel{inset:0;width:100%;height:100%;height:100dvh;max-height:none;border-radius:0}" +
    "html.ba-open .ba-fab{display:none}html.ba-open,html.ba-open body{overflow:hidden}}";

  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  var fab = document.createElement("button");
  fab.type = "button";
  fab.className = "ba-fab";
  fab.setAttribute("aria-label", "블로그에 질문하기");
  fab.setAttribute("aria-expanded", "false");
  fab.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
    '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';

  var panel = document.createElement("div");
  panel.className = "ba-panel";
  panel.hidden = true;

  var frame = document.createElement("iframe");
  frame.title = "블로그 AI 채팅";
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups allow-top-navigation-by-user-activation");
  panel.appendChild(frame);

  document.body.appendChild(panel);
  document.body.appendChild(fab);

  function remember(open) {
    try {
      sessionStorage.setItem(OPEN_KEY, open ? "1" : "0");
    } catch (e) {}
  }

  function open() {
    if (!frame.getAttribute("src")) {
      frame.src = ORIGIN + "/embed?from=" + encodeURIComponent(location.href);
    }
    panel.hidden = false;
    fab.setAttribute("aria-expanded", "true");
    document.documentElement.classList.add("ba-open");
    remember(true);
    frame.focus();
  }

  function close() {
    panel.hidden = true;
    fab.setAttribute("aria-expanded", "false");
    document.documentElement.classList.remove("ba-open");
    remember(false);
    fab.focus();
  }

  fab.addEventListener("click", function () {
    panel.hidden ? open() : close();
  });

  window.addEventListener("message", function (e) {
    if (e.origin !== ORIGIN) return;
    if (e.data && e.data.type === "blog-agent:close") close();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !panel.hidden) close();
  });

  try {
    if (sessionStorage.getItem(OPEN_KEY) === "1") open();
  } catch (e) {}
})();
