const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { handler } = require('../../src/handler');

// Abrir una base nueva por prueba para no depender del orden ni de corridas anteriores
beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wallet-'));
  process.env.DB_PATH = path.join(dir, 'wallet.db');
});

async function llamar(metodo, ruta, cuerpo) {
  const r = await handler({
    rawPath: ruta,
    requestContext: { http: { method: metodo } },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  return { status: r.statusCode, cuerpo: JSON.parse(r.body) };
}

function transferir(origen, destino, monto) {
  return llamar('POST', '/transferir', { origen, destino, monto });
}

test('ana transfiere 100 a beto', async () => {
  const r = await transferir('ana', 'beto', 100);
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.saldoOrigen, 900);
});

test('el saldo de ana refleja el debito', async () => {
  await transferir('ana', 'beto', 100);
  const r = await llamar('GET', '/saldo/ana');
  assert.deepEqual(r.cuerpo, { usuario: 'ana', saldo: 900 });
});

test('el saldo de beto refleja el credito', async () => {
  await transferir('ana', 'beto', 100);
  const r = await llamar('GET', '/saldo/beto');
  assert.deepEqual(r.cuerpo, { usuario: 'beto', saldo: 600 });
});

test('el historial de ana registra la transferencia', async () => {
  await transferir('ana', 'beto', 100);
  const r = await llamar('GET', '/historial/ana');
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.length, 1);
  assert.equal(r.cuerpo[0].destino, 'beto');
  assert.equal(r.cuerpo[0].monto, 100);
});

test('ana no puede transferir mas que su saldo', async () => {
  const r = await transferir('ana', 'carla', 1000.01);
  assert.equal(r.status, 400);
  assert.equal(r.cuerpo.error, 'saldo insuficiente');
});

test('una transferencia rechazada no cambia saldos', async () => {
  await transferir('ana', 'carla', 1000.01);
  const ana = await llamar('GET', '/saldo/ana');
  const carla = await llamar('GET', '/saldo/carla');
  assert.equal(ana.cuerpo.saldo, 1000);
  assert.equal(carla.cuerpo.saldo, 750);
});

test('diego transfiere todo su saldo a elena', async () => {
  const r = await transferir('diego', 'elena', 300);
  assert.equal(r.status, 200);
  const elena = await llamar('GET', '/saldo/elena');
  assert.equal(elena.cuerpo.saldo, 1500);
});

test('diego sin saldo no puede transferir', async () => {
  await transferir('diego', 'elena', 300);
  const r = await transferir('diego', 'ana', 0.01);
  assert.equal(r.status, 400);
});

test('el historial de elena muestra solo la transferencia de diego', async () => {
  await transferir('diego', 'elena', 300);
  await transferir('ana', 'beto', 100);
  const r = await llamar('GET', '/historial/elena');
  assert.equal(r.cuerpo.length, 1);
  assert.equal(r.cuerpo[0].origen, 'diego');
});

test('transferir al mismo usuario es 422', async () => {
  const r = await transferir('beto', 'beto', 1);
  assert.equal(r.status, 422);
});

test('transferir a un usuario inexistente es 400', async () => {
  const r = await transferir('beto', 'zoe', 1);
  assert.equal(r.status, 400);
});

test('un cuerpo que no es JSON es 400', async () => {
  const r = await handler({
    rawPath: '/transferir',
    requestContext: { http: { method: 'POST' } },
    body: 'monto=1',
  });
  assert.equal(r.statusCode, 400);
});
