// Full-page navigation away from the app. One object, so tests can replace it: jsdom can't
// navigate, and window.location can't be stubbed.
export const browser = {
  assign: (url: string): void => window.location.assign(url),
};
