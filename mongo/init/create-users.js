// Un usuario por base con readWrite solo sobre su base. Crea o actualiza (idempotente).
const users = [
  { user: "social", pwd: process.env.SOCIAL_MONGO_PASSWORD, db: "social" },
  { user: "media",  pwd: process.env.MEDIA_MONGO_PASSWORD,  db: "media"  },
];
for (const u of users) {
  if (!u.pwd) throw new Error("falta la contraseña de " + u.user);
  const target = db.getSiblingDB(u.db);
  const roles = [{ role: "readWrite", db: u.db }];
  if (target.getUser(u.user)) {
    target.updateUser(u.user, { pwd: u.pwd, roles });
    print("usuario actualizado: " + u.user);
  } else {
    target.createUser({ user: u.user, pwd: u.pwd, roles });
    print("usuario creado: " + u.user);
  }
}
