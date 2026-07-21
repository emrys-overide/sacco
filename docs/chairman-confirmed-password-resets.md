# Chairman-confirmed password resets

The application does not send password-reset emails or recovery codes.

1. A Member selects **Request password reset** on the sign-in screen, enters
   their registered phone number or email address, and then contacts the
   Chairman or SACCO Administrator directly to confirm their identity.
2. The application gives a generic confirmation message and creates a pending
   request only when it matches an active Member account. This prevents people
   from discovering whether another person has an account.
3. Every active Chairman (the SACCO Administrator role) receives an unread
   in-app notification that links to **Account Access**. No email or SMS is
   sent.
4. The Chairman opens **Account Access** and verifies the member’s identity
   using the SACCO’s normal process (for example, the registered phone number,
   national ID, or an in-person confirmation).
5. The Chairman selects **Confirm & set temporary password**, creates a
   temporary password of at least eight characters, and shares it privately.
6. The request is marked completed. The temporary password expires after 24
   hours and works only to reach the mandatory **Create a private password**
   screen. It cannot open normal SACCO pages.

Every Chairman approval is written to the audit log. Officers still need the
Chairman to reset their password directly from **Account Access**; only Members
can submit a public reset request.
