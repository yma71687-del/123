import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
declare const __NEXUS_OFFLINE_PREVIEW__: boolean;
// A literal build flag keeps the historical standalone bundle free of studio code/CSS.
if (
  typeof __NEXUS_OFFLINE_PREVIEW__ !== "undefined" &&
  __NEXUS_OFFLINE_PREVIEW__
) {
  createRoot(document.getElementById("root")!).render(<App />);
} else {
  const root = createRoot(document.getElementById("root")!);
  let navigation = 0;
  const render = () => {
    const version = ++navigation;
    if (location.hash !== "#studio") {
      root.render(
        <>
          <App />
          <a
            href="#studio"
            style={{
              position: "fixed",
              right: 18,
              bottom: 18,
              zIndex: 1000,
              padding: "10px 16px",
              borderRadius: 9,
              background: "#9ae7d7",
              color: "#102a28",
              fontSize: 12,
              textDecoration: "none",
              boxShadow: "0 3px 20px #0005",
            }}
          >
            新版创作工作台 ↗
          </a>
        </>,
      );
      return;
    }
    root.render(<p>正在打开创作工作台…</p>);
    void import("./studio/Studio")
      .then(({ Studio }) => {
        if (version === navigation) root.render(<Studio />);
      })
      .catch(() => {
        if (version === navigation)
          root.render(<p role="alert">创作工作台加载失败，请刷新后重试。</p>);
      });
  };
  window.addEventListener("hashchange", render);
  render();
}
