// Runtime configuration for the collaborative canvas frontend.
// Update `backendUrl` before deploying to Vercel so the client knows where the Socket.IO server lives.
(function configureApp() {
  const defaults = {
    backendUrl: "http://localhost:3000",
  };

  if (!window.APP_CONFIG || typeof window.APP_CONFIG !== "object") {
    window.APP_CONFIG = { ...defaults };
    return;
  }

  window.APP_CONFIG = { ...defaults, ...window.APP_CONFIG };
})();
