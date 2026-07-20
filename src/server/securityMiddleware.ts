import type { Express, NextFunction, Request, Response } from 'express';

export function configureProxyTrust(app: Express, trustProxyValue: unknown) {
  const trustProxy = String(trustProxyValue || '').trim().toLowerCase();
  if (trustProxy === '1' || trustProxy === 'true') app.set('trust proxy', 1);
  else if (trustProxy && trustProxy !== '0' && trustProxy !== 'false') {
    throw new Error('TRUST_PROXY must be true/false or 1/0.');
  }
}

export function securityHeaders(isProduction: boolean) {
  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

    const cspDirectives = isProduction
      ? "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'"
      : "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:";

    res.setHeader('Content-Security-Policy', cspDirectives);
    if (isProduction && req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  };
}
