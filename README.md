# Financiera Viafara — ERP Bancario

Sistema ERP bancario desarrollado para la Guía 1 de Sistemas Transaccionales — Universidad Manuela Beltrán.

## Tecnologías
- **Backend:** Node.js + Express
- **Base de datos:** Microsoft SQL Server 2022 (Docker)
- **Frontend:** HTML + CSS + JavaScript (SPA)

## Módulos
- Portal Admin: Dashboard, Cuentas, Transferencias, Solicitudes, Usuarios, Inventario
- Portal Cliente: Mis cuentas, Transferir, Solicitar servicio, Movimientos, Mis solicitudes

## Propiedades ACID implementadas
- **Atomicidad:** Transferencias con BEGIN TRANSACTION / ROLLBACK automático
- **Consistencia:** Constraint saldo >= 0 en CuentasBancarias
- **Aislamiento:** Nivel READ COMMITTED en SQL Server 2022
- **Durabilidad:** Modelo de recuperación FULL — datos persistentes ante fallos

## Instalación
```bash
npm install
node server.js
```
Requiere SQL Server en Docker en puerto 1433.

## Autor
Daniel Viafara — Ingeniería de Software UMB 2026
