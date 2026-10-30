// ============================================================================
// INDUSTRAC S.A.C. — MÓDULO DE AUTENTICACIÓN Y SEGURIDAD DE SESIÓN
// Generación y verificación criptográfica de tokens (HMAC-SHA256)
// Integración con Supabase Auth y Cookies HttpOnly seguras
// ============================================================================

const crypto = require('crypto');
const { supabase } = require('../db/supabase');
require('dotenv').config();

// Almacén en memoria para limitar intentos de inicio de sesión por IP
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_PERIOD_MS = 15 * 60 * 1000; // 15 minutos

function checkRateLimit(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record) return { allowed: true };

  // Limpiar si el tiempo expiró
  if (now - record.firstAttempt > LOCKOUT_PERIOD_MS) {
    loginAttempts.delete(ip);
    return { allowed: true };
  }

  if (record.count >= MAX_ATTEMPTS) {
    const remainingSecs = Math.ceil((record.firstAttempt + LOCKOUT_PERIOD_MS - now) / 1000);
    return {
      allowed: false,
      remainingSecs,
      error: `Demasiados intentos fallidos. Intente nuevamente en ${Math.ceil(remainingSecs / 60)} minuto(s).`
    };
  }

  return { allowed: true };
}

function recordFailedAttempt(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record) {
    loginAttempts.set(ip, { count: 1, firstAttempt: now });
  } else {
    record.count += 1;
  }
}

function resetAttempts(ip) {
  loginAttempts.delete(ip);
}

function getSecret() {
  const secret = (process.env.API_SECRET_KEY || process.env.SUPABASE_SECRET_KEY || '').trim();
  if (!secret) {
    throw new Error('No se ha configurado API_SECRET_KEY ni SUPABASE_SECRET_KEY en las variables de entorno.');
  }
  return secret;
}

/**
 * Opciones seguras para cookie de sesión
 */
function getCookieOptions() {
  const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 días
    path: '/'
  };
}

/**
 * Crea un token de sesión firmado criptográficamente
 */
function createSessionToken(user, expiresInMs = 7 * 24 * 60 * 60 * 1000) {
  const secret = getSecret();
  const payload = {
    id: user.id || 'admin',
    email: user.email || 'admin@industrac.com',
    role: user.role || 'admin',
    name: user.name || 'Personal INDUSTRAC',
    exp: Date.now() + expiresInMs
  };

  const b64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(b64Payload).digest('base64url');
  return `${b64Payload}.${signature}`;
}

/**
 * Verifica y descifra el token de sesión. Retorna el payload si es válido o null.
 */
function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  try {
    const secret = getSecret();
    const [b64Payload, signature] = parts;
    const expectedSig = crypto.createHmac('sha256', secret).update(b64Payload).digest('base64url');

    if (signature.length !== expectedSig.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) return null;

    const payload = JSON.parse(Buffer.from(b64Payload, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;

    return payload;
  } catch (err) {
    return null;
  }
}

/**
 * Autentica credenciales contra Supabase Auth o Clave Maestra de Administrador
 */
async function authenticateUser(email, password, ip = '127.0.0.1') {
  const rateLimit = checkRateLimit(ip);
  if (!rateLimit.allowed) {
    return { ok: false, error: rateLimit.error, rateLimited: true };
  }

  if (!password || typeof password !== 'string') {
    recordFailedAttempt(ip);
    return { ok: false, error: 'La contraseña es requerida.' };
  }

  const apiSecret = (process.env.API_SECRET_KEY || '').trim();

  // Opción 1: Autenticación con Clave Maestra de Administrador de INDUSTRAC
  if (apiSecret && password.trim() === apiSecret) {
    resetAttempts(ip);
    return {
      ok: true,
      user: {
        id: 'industrac-admin',
        email: email && email.includes('@') ? email.trim() : 'admin@industrac.com',
        role: 'admin',
        name: 'Administrador General INDUSTRAC'
      }
    };
  }

  // Opción 2: Autenticación mediante Supabase Auth
  if (supabase && email && email.includes('@')) {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: password
      });

      if (!error && data?.user) {
        resetAttempts(ip);
        return {
          ok: true,
          user: {
            id: data.user.id,
            email: data.user.email,
            role: data.user.user_metadata?.role || 'operator',
            name: data.user.user_metadata?.name || data.user.email.split('@')[0]
          }
        };
      }
      if (error) {
        recordFailedAttempt(ip);
        return { ok: false, error: 'Credenciales inválidas o usuario no registrado en Supabase.' };
      }
    } catch (sbErr) {
      console.error('[Auth] Error al conectar con Supabase Auth:', sbErr.message);
    }
  }

  recordFailedAttempt(ip);
  return { ok: false, error: 'Credenciales incorrectas. Verifique su correo y contraseña.' };
}

/**
 * Middleware para validar autenticación en rutas privadas / mutaciones
 * Acepta cookie 'industrac_session', cabecera 'Authorization: Bearer <token>', o 'x-api-key'.
 * ELIMINA DEFINITIVAMENTE la vulnerabilidad isSameOrigin.
 */
function requireAuth(req, res, next) {
  // 1. Extraer token de cookie o cabecera Authorization
  const token = req.cookies?.industrac_session ||
    (req.headers.authorization ? req.headers.authorization.replace(/^Bearer\s+/i, '') : null);

  if (token) {
    const session = verifySessionToken(token);
    if (session) {
      req.user = session;
      return next();
    }
  }

  // 2. Soporte para integraciones y scripts automáticos con x-api-key
  const apiSecret = (process.env.API_SECRET_KEY || '').trim();
  const apiKey = req.headers['x-api-key'];
  if (apiSecret && apiKey && apiKey.trim() === apiSecret) {
    req.user = { id: 'api-service', email: 'service@industrac.com', role: 'admin', name: 'Servicio API INDUSTRAC' };
    return next();
  }

  return res.status(401).json({
    ok: false,
    error: 'Acceso no autorizado: Debe iniciar sesión con credenciales válidas de INDUSTRAC.'
  });
}

/**
 * Middleware opcional para verificar sesión sin bloquear
 */
function optionalAuth(req, res, next) {
  const token = req.cookies?.industrac_session ||
    (req.headers.authorization ? req.headers.authorization.replace(/^Bearer\s+/i, '') : null);

  if (token) {
    const session = verifySessionToken(token);
    if (session) {
      req.user = session;
    }
  }
  next();
}

module.exports = {
  createSessionToken,
  verifySessionToken,
  authenticateUser,
  requireAuth,
  optionalAuth,
  getCookieOptions
};
