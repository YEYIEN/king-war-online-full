(() => {
  const VERSION_URL = "/version.json";
  const STORAGE_KEY = "king-war-current-version";
  const CHECK_INTERVAL_MS = 60 * 1000;

  let showing = false;
  let reloading = false;

  function createBanner(remoteVersion) {
    if (showing) return;
    showing = true;

    const banner = document.createElement("div");
    banner.id = "kw-update-banner";
    banner.innerHTML = `
      <div class="kw-update-card">
        <strong>發現新版本</strong>
        <span>點擊更新，不需要刪除 PWA</span>
        <button type="button">立即更新</button>
      </div>
    `;

    const style = document.createElement("style");
    style.textContent = `
      #kw-update-banner {
        position: fixed;
        left: 12px;
        right: 12px;
        bottom: 12px;
        z-index: 99999;
        display: grid;
        place-items: center;
        pointer-events: none;
      }

      #kw-update-banner .kw-update-card {
        width: min(520px, 100%);
        display: grid;
        grid-template-columns: 1fr auto;
        grid-template-areas:
          "title button"
          "text button";
        gap: 4px 12px;
        align-items: center;
        padding: 12px 14px;
        border-radius: 18px;
        border: 1px solid #38bdf8;
        background:
          radial-gradient(circle at top, rgba(56, 189, 248, 0.2), transparent 46%),
          rgba(15, 23, 42, 0.97);
        box-shadow: 0 18px 60px rgba(0,0,0,.45);
        color: #e2e8f0;
        pointer-events: auto;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      #kw-update-banner strong {
        grid-area: title;
        font-size: 15px;
        color: #f8fafc;
      }

      #kw-update-banner span {
        grid-area: text;
        font-size: 12px;
        color: #bae6fd;
      }

      #kw-update-banner button {
        grid-area: button;
        border: none;
        border-radius: 12px;
        padding: 10px 12px;
        background: #38bdf8;
        color: #082f49;
        font-weight: 900;
        cursor: pointer;
      }

      @media (max-width: 520px) {
        #kw-update-banner {
          bottom: max(12px, env(safe-area-inset-bottom));
        }

        #kw-update-banner .kw-update-card {
          grid-template-columns: 1fr;
          grid-template-areas:
            "title"
            "text"
            "button";
        }

        #kw-update-banner button {
          width: 100%;
          margin-top: 6px;
        }
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(banner);

    const button = banner.querySelector("button");

    button.addEventListener("click", async () => {
      if (reloading) return;
      reloading = true;

      try {
        localStorage.setItem(STORAGE_KEY, remoteVersion);

        if ("serviceWorker" in navigator) {
          const registration = await navigator.serviceWorker.getRegistration();

          if (registration) {
            await registration.update();

            if (registration.waiting) {
              registration.waiting.postMessage({ type: "SKIP_WAITING" });
            }
          }
        }
      } catch (err) {
        console.warn("PWA update trigger failed:", err);
      }

      window.location.reload();
    });
  }

  async function fetchVersion() {
    const res = await fetch(`${VERSION_URL}?t=${Date.now()}`, {
      cache: "no-store"
    });

    if (!res.ok) throw new Error("version.json fetch failed");

    return res.json();
  }

  async function checkVersion() {
    try {
      const data = await fetchVersion();
      const remoteVersion = data?.version;

      if (!remoteVersion) return;

      const currentVersion = localStorage.getItem(STORAGE_KEY);

      if (!currentVersion) {
        localStorage.setItem(STORAGE_KEY, remoteVersion);
        return;
      }

      if (currentVersion !== remoteVersion) {
        createBanner(remoteVersion);
      }
    } catch (err) {
      console.warn("Version check failed:", err);
    }
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js");

        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          if (!worker) return;

          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              checkVersion();
            }
          });
        });

        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (reloading) return;
          reloading = true;
          window.location.reload();
        });
      } catch (err) {
        console.warn("Service worker registration failed:", err);
      }

      checkVersion();
      window.setInterval(checkVersion, CHECK_INTERVAL_MS);
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        checkVersion();
      }
    });
  } else {
    window.addEventListener("load", () => {
      checkVersion();
      window.setInterval(checkVersion, CHECK_INTERVAL_MS);
    });
  }
})();
