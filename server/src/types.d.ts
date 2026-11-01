declare global {
  namespace Express {
    interface Request {
      auth?: {
        user: { id: string; loginId: string; displayName: string; mustChangePassword: boolean; mfaEnabled: boolean };
        roles: string[];
        permissions: string[];
        csrfToken: string;
        tokenHash: string;
      };
    }
  }
}
export {};
