// Only does anything inside the Android app (mobile/, Capacitor), where
// window.Capacitor is injected. On the website this file is a no-op.
//  - A WhatsApp link (https://competitive.waynur.com/go/...) opened in the app
//    goes to that page inside the app.
//  - The phone's back button goes back a page, and only closes the app on
//    the first screen.
export function setupNative() {
  const App = window.Capacitor?.Plugins?.App;
  if (!App) return;
  App.addListener('appUrlOpen', ({ url }) => {
    try {
      const u = new URL(url);
      if (u.host === window.location.host) window.location.assign(`${u.pathname}${u.search}`);
    } catch { /* not a URL we handle */ }
  });
  App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack && !['/', '/app'].includes(window.location.pathname)) window.history.back();
    else App.exitApp();
  });
}

export const inApp = () => Boolean(window.Capacitor?.isNativePlatform?.());
