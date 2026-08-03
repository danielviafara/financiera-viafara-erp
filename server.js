const express = require('express');
const sql = require('mssql');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const config = {
  user: 'SA', password: 'Lab@12345!', server: 'localhost', port: 1433,
  database: 'BancoACID', options: { trustServerCertificate: true },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
};

let pool;
async function getPool() {
  if (!pool) pool = await sql.connect(config);
  return pool;
}

app.post('/api/login', async (req, res) => {
  try {
    const p = await getPool();
    const r = p.request();
    r.input('e', sql.VarChar, req.body.email);
    r.input('p', sql.VarChar, req.body.password);
    const result = await r.query('SELECT id,nombre,email,rol FROM Usuarios WHERE email=@e AND password=@p');
    if (result.recordset.length) res.json({ ok: true, usuario: result.recordset[0] });
    else res.json({ ok: false, error: 'Credenciales incorrectas' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/usuarios', async (req, res) => {
  try { const p = await getPool(); const r = await p.request().query('SELECT id,nombre,email,rol FROM Usuarios ORDER BY id'); res.json(r.recordset); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/productos', async (req, res) => {
  try { const p = await getPool(); const r = await p.request().query('SELECT * FROM Productos ORDER BY categoria,nombre'); res.json(r.recordset); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/cuentas', async (req, res) => {
  try {
    const p = await getPool();
    const r = await p.request().query('SELECT c.*,u.nombre as titular FROM CuentasBancarias c JOIN Usuarios u ON c.usuario_id=u.id ORDER BY c.id');
    res.json(r.recordset);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/cuentas/usuario/:id', async (req, res) => {
  try {
    const p = await getPool();
    const r = p.request();
    r.input('uid', sql.Int, req.params.id);
    const result = await r.query("SELECT * FROM CuentasBancarias WHERE usuario_id=@uid AND estado='activa' ORDER BY id");
    res.json(result.recordset);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/transferencia', async (req, res) => {
  const { cuenta_origen_id, cuenta_destino_id, monto, descripcion } = req.body;
  const p = await getPool();
  const tx = new sql.Transaction(p);
  try {
    await tx.begin();
    const r1 = new sql.Request(tx);
    r1.input('id', sql.Int, cuenta_origen_id);
    const origen = await r1.query('SELECT saldo,estado FROM CuentasBancarias WHERE id=@id');
    if (!origen.recordset.length) throw new Error('Cuenta origen no encontrada');
    if (origen.recordset[0].estado !== 'activa') throw new Error('Cuenta origen inactiva');
    if (parseFloat(origen.recordset[0].saldo) < parseFloat(monto)) throw new Error('Saldo insuficiente — Consistencia ACID: constraint saldo >= 0 activado');
    const r2 = new sql.Request(tx);
    r2.input('id', sql.Int, cuenta_destino_id);
    const destino = await r2.query('SELECT estado FROM CuentasBancarias WHERE id=@id');
    if (!destino.recordset.length) throw new Error('Cuenta destino no encontrada');
    if (destino.recordset[0].estado !== 'activa') throw new Error('Cuenta destino inactiva');
    const r3 = new sql.Request(tx);
    r3.input('m', sql.Decimal(12,2), monto); r3.input('id', sql.Int, cuenta_origen_id);
    await r3.query('UPDATE CuentasBancarias SET saldo=saldo-@m WHERE id=@id');
    const r4 = new sql.Request(tx);
    r4.input('m', sql.Decimal(12,2), monto); r4.input('id', sql.Int, cuenta_destino_id);
    await r4.query('UPDATE CuentasBancarias SET saldo=saldo+@m WHERE id=@id');
    const r5 = new sql.Request(tx);
    r5.input('o', sql.Int, cuenta_origen_id); r5.input('d', sql.Int, cuenta_destino_id);
    r5.input('m', sql.Decimal(12,2), monto); r5.input('desc', sql.VarChar, descripcion||'Transferencia');
    const txRes = await r5.query('INSERT INTO Transacciones (cuenta_origen,cuenta_destino,monto,descripcion) OUTPUT INSERTED.id VALUES (@o,@d,@m,@desc)');
    await tx.commit();
    res.json({ ok: true, transaccion_id: txRes.recordset[0].id, mensaje: 'COMMIT exitoso — Durabilidad garantizada.' });
  } catch(e) {
    try { await tx.rollback(); } catch(_) {}
    res.status(400).json({ ok: false, error: e.message, rollback: true });
  }
});

app.get('/api/transacciones', async (req, res) => {
  try {
    const p = await getPool();
    const r = await p.request().query(`SELECT t.*,uo.nombre as origen_titular,co.numero_cuenta as origen_cuenta,ud.nombre as destino_titular,cd.numero_cuenta as destino_cuenta FROM Transacciones t JOIN CuentasBancarias co ON t.cuenta_origen=co.id JOIN CuentasBancarias cd ON t.cuenta_destino=cd.id JOIN Usuarios uo ON co.usuario_id=uo.id JOIN Usuarios ud ON cd.usuario_id=ud.id ORDER BY t.fecha DESC`);
    res.json(r.recordset);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/transacciones/usuario/:id', async (req, res) => {
  try {
    const p = await getPool();
    const r = p.request();
    r.input('uid', sql.Int, req.params.id);
    const result = await r.query(`SELECT t.*,co.numero_cuenta as origen_cuenta,cd.numero_cuenta as destino_cuenta,uo.nombre as origen_titular,ud.nombre as destino_titular FROM Transacciones t JOIN CuentasBancarias co ON t.cuenta_origen=co.id JOIN CuentasBancarias cd ON t.cuenta_destino=cd.id JOIN Usuarios uo ON co.usuario_id=uo.id JOIN Usuarios ud ON cd.usuario_id=ud.id WHERE co.usuario_id=@uid OR cd.usuario_id=@uid ORDER BY t.fecha DESC`);
    res.json(result.recordset);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/solicitudes', async (req, res) => {
  try {
    const p = await getPool();
    const r = await p.request().query(`SELECT s.*,u.nombre as cliente,pr.nombre as producto,pr.categoria FROM Solicitudes s JOIN Usuarios u ON s.usuario_id=u.id JOIN Productos pr ON s.producto_id=pr.id ORDER BY s.fecha DESC`);
    res.json(r.recordset);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/solicitudes/usuario/:id', async (req, res) => {
  try {
    const p = await getPool();
    const r = p.request();
    r.input('uid', sql.Int, req.params.id);
    const result = await r.query(`SELECT s.*,pr.nombre as producto,pr.categoria,pr.descripcion FROM Solicitudes s JOIN Productos pr ON s.producto_id=pr.id WHERE s.usuario_id=@uid ORDER BY s.fecha DESC`);
    res.json(result.recordset);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/solicitudes', async (req, res) => {
  const { usuario_id, producto_id } = req.body;
  try {
    const p = await getPool();
    const check = await p.request().input('uid', sql.Int, usuario_id).input('pid', sql.Int, producto_id).query("SELECT id FROM Solicitudes WHERE usuario_id=@uid AND producto_id=@pid AND estado='pendiente'");
    if (check.recordset.length) return res.json({ ok: false, error: 'Ya tienes una solicitud pendiente para este producto' });
    const r = p.request();
    r.input('uid', sql.Int, usuario_id); r.input('pid', sql.Int, producto_id);
    const result = await r.query('INSERT INTO Solicitudes (usuario_id,producto_id) OUTPUT INSERTED.id VALUES (@uid,@pid)');
    res.json({ ok: true, solicitud_id: result.recordset[0].id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/solicitudes/:id/aprobar', async (req, res) => {
  const p = await getPool();
  const tx = new sql.Transaction(p);
  try {
    await tx.begin();
    const r1 = new sql.Request(tx);
    r1.input('id', sql.Int, req.params.id);
    const sol = await r1.query(`SELECT s.*,pr.categoria,pr.nombre as producto,u.nombre as cliente FROM Solicitudes s JOIN Productos pr ON s.producto_id=pr.id JOIN Usuarios u ON s.usuario_id=u.id WHERE s.id=@id`);
    if (!sol.recordset.length) throw new Error('Solicitud no encontrada');
    const s = sol.recordset[0];
    await new sql.Request(tx).input('id', sql.Int, req.params.id).query("UPDATE Solicitudes SET estado='aprobada',observacion='Aprobada por administrador' WHERE id=@id");
    if (s.categoria === 'Cuentas') {
      const r3 = new sql.Request(tx);
      r3.input('uid', sql.Int, s.usuario_id); r3.input('tipo', sql.VarChar, 'ahorro'); r3.input('num', sql.VarChar, `${Date.now()}-FV`);
      await r3.query('INSERT INTO CuentasBancarias (usuario_id,tipo,numero_cuenta,saldo) VALUES (@uid,@tipo,@num,500000)');
    }
    await tx.commit();
    res.json({ ok: true, mensaje: `Solicitud de ${s.cliente} aprobada`+(s.categoria==='Cuentas'?' — Cuenta creada con saldo inicial $500,000':'') });
  } catch(e) { try { await tx.rollback(); } catch(_) {} res.status(400).json({ ok: false, error: e.message }); }
});

app.put('/api/solicitudes/:id/rechazar', async (req, res) => {
  try {
    const p = await getPool();
    const r = p.request();
    r.input('id', sql.Int, req.params.id);
    r.input('obs', sql.VarChar, req.body.motivo||'No cumple requisitos');
    await r.query("UPDATE Solicitudes SET estado='rechazada',observacion=@obs WHERE id=@id");
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/dashboard', async (req, res) => {
  try {
    const p = await getPool();
    const [u,c,t,s,sd] = await Promise.all([
      p.request().query('SELECT COUNT(*) n FROM Usuarios'),
      p.request().query("SELECT COUNT(*) n FROM CuentasBancarias WHERE estado='activa'"),
      p.request().query('SELECT COUNT(*) n FROM Transacciones'),
      p.request().query("SELECT COUNT(*) n FROM Solicitudes WHERE estado='pendiente'"),
      p.request().query("SELECT ISNULL(SUM(saldo),0) n FROM CuentasBancarias WHERE estado='activa'")
    ]);
    res.json({ usuarios:u.recordset[0].n, cuentas:c.recordset[0].n, transacciones:t.recordset[0].n, pendientes:s.recordset[0].n, saldo_total:sd.recordset[0].n });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.listen(3000, () => console.log('Financiera Viafara ERP corriendo en http://localhost:3000'));
