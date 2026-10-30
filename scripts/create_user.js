// ============================================================================
// INDUSTRAC S.A.C. — SCRIPT DE CREACIÓN SEGURA DE USUARIOS EN SUPABASE AUTH
// Ejecutable desde CLI exclusivamente por el administrador del sistema
// ============================================================================

require('dotenv').config();
const { supabase } = require('../db/supabase');

async function createAdminUser(email, password, role = 'admin', fullName = 'Administrador INDUSTRAC') {
  if (!email || !password) {
    console.error('Uso: node scripts/create_user.js <correo> <contraseña> [rol] [nombre]');
    process.exit(1);
  }

  if (password.length < 6) {
    console.error('Error: La contraseña debe tener al menos 6 caracteres.');
    process.exit(1);
  }

  try {
    console.log(`[INDUSTRAC] Creando usuario para: ${email}...`);
    const { data, error } = await supabase.auth.admin.createUser({
      email: email.trim(),
      password: password.trim(),
      email_confirm: true,
      user_metadata: {
        role: role.trim(),
        name: fullName.trim()
      }
    });

    if (error) {
      console.error(`[INDUSTRAC] Error de Supabase Auth: ${error.message}`);
      process.exit(1);
    }

    console.log(`[INDUSTRAC] ¡Usuario creado exitosamente en Supabase Auth!`);
    console.log(`- ID: ${data.user.id}`);
    console.log(`- Correo: ${data.user.email}`);
    console.log(`- Rol: ${role}`);
    console.log(`- Confirmado: Sí (listo para iniciar sesión)`);
  } catch (err) {
    console.error(`[INDUSTRAC] Excepción al crear usuario:`, err.message);
    process.exit(1);
  }
}

const args = process.argv.slice(2);
if (args.length >= 2) {
  const [email, password, role, fullName] = args;
  createAdminUser(email, password, role || 'admin', fullName || 'Operador INDUSTRAC');
} else {
  console.log('Script de administración de usuarios INDUSTRAC');
  console.log('Uso: node scripts/create_user.js <correo> <contraseña> [rol] [nombre]');
  console.log('Ejemplo: node scripts/create_user.js supervisor@industrac.com Secreto123 admin "Supervisor Técnico"');
}

