// rs.initiate solo si el replica set aún no existe.
let initialized = false;
try { rs.status(); initialized = true; } catch (e) { initialized = false; }
if (!initialized) {
  printjson(rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "mongo:27017" }] }));
} else {
  print("rs0 ya inicializado");
}
