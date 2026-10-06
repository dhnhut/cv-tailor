// What the pre sign-up trigger tells a refused person (S2-07, ADR-0009 §2). Cognito wraps each one
// as "PreSignUp failed with error <message>." and adds the final full stop itself, so they leave it
// out. For a Google sign-in, the text reaches the web app's callback as error_description, and the
// web app shows only these, so a crafted link can't put its own text on the page (S2-10). No zod
// here: the trigger imports this file on its own (package.json "exports"), so its bundle stays small.
export const PRE_SIGN_UP_MESSAGES = {
  googleNotTrusted:
    'Google sign-in works only for Gmail and Google Workspace addresses. Please sign up with your email address and a password', // case 6
  useYourPassword:
    'An account with this email address already exists. Please sign in with your password', // cases 7 and 10
  failed: 'Sign-in failed. Please try again', // anything unexpected: fail closed
} as const;
