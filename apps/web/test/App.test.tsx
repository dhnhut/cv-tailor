import type { WebConfig } from '@cv-tailor/contracts';
import { PRE_SIGN_UP_MESSAGES } from '@cv-tailor/contracts/sign-in-messages';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { UserManager } from 'oidc-client-ts';
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, type Mock, type MockInstance, test, vi } from 'vitest';
import { App } from '../src/App';
import { GENERIC_SIGN_IN_ERROR } from '../src/auth/callback-error';
import { logoutUrl } from '../src/auth/sign-out';
import { browser } from '../src/browser';
import { EMAIL, renderApp, signedInUser, SUB, testUserManager } from './auth-helpers';
import { DEV_CONFIG } from './fixtures';

// The whole app through the real AuthProvider and UserManager, with real session storage (S2-10).
// Only the calls that would leave the page or reach Cognito are replaced: signinRedirect,
// signinCallback, revokeTokens, and browser.assign. fetch answers GET /me.

let manager: UserManager;
let signinRedirect: MockInstance<UserManager['signinRedirect']>;
let fetchMock: Mock<typeof fetch>;

// A fresh Response for each call: a body can be read only once.
const meAnswer = (isAdmin: boolean) => () => Promise.resolve(Response.json({ sub: SUB, isAdmin }));
const statusAnswer = (status: number) => () => Promise.resolve(new Response(null, { status }));

beforeEach(() => {
  manager = testUserManager();
  signinRedirect = vi.spyOn(manager, 'signinRedirect').mockResolvedValue();
  fetchMock = vi.fn<typeof fetch>(meAnswer(true));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// As a finished sign-in leaves it: the user in session storage, before the page loads.
const signIn = () => manager.storeUser(signedInUser());

const callbackWithError = (description: string) =>
  `/auth/callback?${new URLSearchParams({ error: 'invalid_request', error_description: description })}`;

// Waits until the provider has read session storage and shows the signed-out home page, so its
// state changes happen inside the test.
const signedOutHome = () => screen.findByRole('button', { name: 'Sign in' });

// --- Layout

test('shows the app name and, outside prod, the environment', async () => {
  render(<App config={DEV_CONFIG} userManager={manager} />);
  await signedOutHome();
  expect(screen.getByRole('heading', { level: 1, name: 'CV Tailor' })).toBeInstanceOf(
    HTMLHeadingElement,
  );
  expect(screen.getByText('dev')).toBeInstanceOf(HTMLParagraphElement);
});

test('hides the environment in prod', async () => {
  const prod: WebConfig = { ...DEV_CONFIG, environment: 'prod' };
  render(<App config={prod} userManager={manager} />);
  await signedOutHome();
  expect(screen.queryByText('prod')).toBeNull();
});

// --- Home

test('signed out, Sign in starts sign-in that comes back to the profile', async () => {
  renderApp(manager);
  fireEvent.click(await signedOutHome());
  await waitFor(() => {
    expect(signinRedirect).toHaveBeenCalledWith({ state: { returnTo: '/profile' } });
  });
});

test('signed in, home links to the profile', async () => {
  await signIn();
  renderApp(manager);
  const link = await screen.findByRole('link', { name: 'Your profile' });
  expect(link.getAttribute('href')).toBe('/profile');
});

test('an unknown path goes home', async () => {
  renderApp(manager, '/nope');
  await signedOutHome();
  expect(window.location.pathname).toBe('/');
});

// --- Protected page (S2-10: a signed-out user who opens a protected page is sent to sign-in)

test('a signed-out visit to the profile goes to sign-in once, and never calls the API', async () => {
  renderApp(manager, '/profile');
  await waitFor(() => {
    expect(signinRedirect).toHaveBeenCalledTimes(1);
  });
  await act(async () => {}); // let the provider settle, so a second redirect would show here
  expect(signinRedirect).toHaveBeenCalledTimes(1);
  expect(signinRedirect).toHaveBeenCalledWith({ state: { returnTo: '/profile' } });
  expect(screen.getByText('Redirecting to sign-in…')).toBeInstanceOf(HTMLParagraphElement);
  expect(fetchMock).not.toHaveBeenCalled();
});

// main.tsx renders in StrictMode, which runs every effect twice in development.
test('in StrictMode, a signed-out visit still starts only one sign-in', async () => {
  window.history.replaceState(null, '', '/profile');
  render(
    <StrictMode>
      <App config={DEV_CONFIG} userManager={manager} />
    </StrictMode>,
  );
  await waitFor(() => {
    expect(signinRedirect).toHaveBeenCalled();
  });
  await act(async () => {});
  expect(signinRedirect).toHaveBeenCalledTimes(1);
});

test("if the sign-in page can't be opened, the protected page says so", async () => {
  signinRedirect.mockRejectedValue(new Error('crypto.subtle unavailable'));
  renderApp(manager, '/profile');
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toBe("Couldn't open the sign-in page. Please reload.");
});

// --- Profile (GET /me)

test('signed in, the profile shows the email from the ID token and the sub and role from GET /me', async () => {
  await signIn();
  renderApp(manager, '/profile');

  expect(await screen.findByText(SUB)).toBeInstanceOf(HTMLElement);
  expect(screen.getByText('Admin')).toBeInstanceOf(HTMLElement);
  expect(screen.getAllByText(EMAIL)).toHaveLength(2); // the header and the profile
  expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/me$/), {
    headers: { Authorization: 'Bearer access-token' }, // the access token, never the ID token
  });
  expect(signinRedirect).not.toHaveBeenCalled();
});

test('in StrictMode, the profile shows one result although the effect runs twice', async () => {
  await signIn();
  window.history.replaceState(null, '', '/profile');
  render(
    <StrictMode>
      <App config={DEV_CONFIG} userManager={manager} />
    </StrictMode>,
  );
  expect(await screen.findByText(SUB)).toBeInstanceOf(HTMLElement);
  expect(screen.queryByRole('alert')).toBeNull();
});

test('a user outside the admin group is shown as a Candidate', async () => {
  fetchMock.mockImplementation(meAnswer(false));
  await signIn();
  renderApp(manager, '/profile');
  expect(await screen.findByText('Candidate')).toBeInstanceOf(HTMLElement);
});

test('when the API refuses the token, the session is cleared and sign-in starts again', async () => {
  fetchMock.mockImplementation(statusAnswer(401));
  await signIn();
  renderApp(manager, '/profile');

  await waitFor(() => {
    expect(signinRedirect).toHaveBeenCalledWith({ state: { returnTo: '/profile' } });
  });
  expect(await manager.getUser()).toBeNull();
});

test('when GET /me fails otherwise, Retry loads it again', async () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  fetchMock.mockImplementationOnce(statusAnswer(500));
  await signIn();
  renderApp(manager, '/profile');

  expect((await screen.findByRole('alert')).textContent).toContain("Couldn't load your profile.");
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText(SUB)).toBeInstanceOf(HTMLElement);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(consoleError).toHaveBeenCalledTimes(1);
});

// --- Callback

test('the callback finishes sign-in and returns to the page that asked, without ?code', async () => {
  const signinCallback = vi
    .spyOn(manager, 'signinCallback')
    .mockResolvedValue(signedInUser({ returnTo: '/profile' }));
  renderApp(manager, '/auth/callback?code=abc&state=xyz');

  expect(await screen.findByText(SUB)).toBeInstanceOf(HTMLElement);
  expect(signinCallback).toHaveBeenCalledTimes(1);
  expect(window.location.pathname).toBe('/profile');
  expect(window.location.search).toBe('');
});

// S2-10: the pre sign-up trigger's message, without "PreSignUp failed with error". The URL has no
// `state`, as seen live in S2-07, so the library doesn't process it and the page reads it.
test("a refused Google sign-in shows the trigger's message, and Try again starts a new sign-in", async () => {
  const message = `${PRE_SIGN_UP_MESSAGES.googleNotTrusted}.`;
  renderApp(manager, callbackWithError(`PreSignUp failed with error ${message}`));

  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain(message);
  expect(alert.textContent).not.toContain('PreSignUp failed');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() => {
    expect(signinRedirect).toHaveBeenCalledTimes(1);
  });
});

test('any other error description shows the generic message, never its own text', async () => {
  renderApp(manager, callbackWithError('Call 0800 000 000 to verify your account'));
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain(GENERIC_SIGN_IN_ERROR);
  expect(alert.textContent).not.toContain('0800');
});

// S2-05: a failed exchange uses up the code, so the only way forward is a new sign-in.
test('a failed code exchange offers a new sign-in', async () => {
  vi.spyOn(manager, 'signinCallback').mockRejectedValue(new Error('invalid_grant'));
  renderApp(manager, '/auth/callback?code=abc&state=xyz');

  expect((await screen.findByRole('alert')).textContent).toContain(GENERIC_SIGN_IN_ERROR);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() => {
    expect(signinRedirect).toHaveBeenCalledTimes(1);
  });
});

test('the callback page without sign-in parameters goes home', async () => {
  renderApp(manager, '/auth/callback');
  await signedOutHome();
  expect(window.location.pathname).toBe('/');
});

// --- Sign-out (ADR-0009 §5)

test('sign-out from the profile revokes, clears, and ends the session, without a new sign-in', async () => {
  // Before render: the provider binds revokeTokens once, when it first renders.
  const revokeTokens = vi.spyOn(manager, 'revokeTokens').mockResolvedValue();
  const assign = vi.spyOn(browser, 'assign').mockImplementation(() => {});
  await signIn();
  renderApp(manager, '/profile');
  await screen.findByText(SUB);

  // A native click, as in a browser, not fireEvent: fireEvent runs inside act(), which flushes the
  // navigation to / at once and so hides the race this test is for. Outside act(), React Router 8
  // applies the navigation as a transition, after the provider's sign-out update.
  screen.getByRole('button', { name: 'Sign out' }).click();

  await waitFor(() => {
    expect(assign).toHaveBeenCalledWith(logoutUrl(DEV_CONFIG, window.location.origin));
  });
  await signedOutHome();
  expect(revokeTokens).toHaveBeenCalledTimes(1);
  expect(await manager.getUser()).toBeNull();
  expect(window.location.pathname).toBe('/');
  expect(signinRedirect).not.toHaveBeenCalled(); // the race in Layout.tsx
});
