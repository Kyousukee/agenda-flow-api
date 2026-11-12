import { randomBytes } from 'crypto';
import {
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CuentasFlowService } from './cuentas-flow.service';
import { CifradoCredenciales } from './cifrado';
import { CuentaFlow } from './entities/cuenta-flow.entity';

function cifradoCon(clave: string | undefined) {
  return new CifradoCredenciales({
    get: () => clave,
  } as unknown as ConfigService);
}

function cuenta(datos: Partial<CuentaFlow>): CuentaFlow {
  return {
    id: 1,
    empresaId: 10,
    sucursalId: null,
    apiKey: 'APIKEY-EMPRESA-1234',
    secretKeyCifrada: 'x',
    fechaCreacion: new Date(),
    fechaActualizacion: null,
    fechaBaja: null,
    ...datos,
  };
}

describe('CuentasFlowService', () => {
  const clave = randomBytes(32).toString('base64');
  let cuentaRepo: { find: jest.Mock; findOne: jest.Mock; manager: unknown };
  let sucursalRepo: { find: jest.Mock; findOne: jest.Mock };
  let manager: { update: jest.Mock; save: jest.Mock; create: jest.Mock };
  let dataSource: { transaction: jest.Mock };

  const crear = (claveCifrado: string | null = clave) =>
    new CuentasFlowService(
      cuentaRepo as never,
      sucursalRepo as never,
      dataSource as never,
      cifradoCon(claveCifrado ?? undefined),
    );

  beforeEach(() => {
    manager = {
      update: jest.fn().mockResolvedValue(undefined),
      save: jest.fn((e: unknown) => Promise.resolve(e)),
      create: jest.fn((_: unknown, datos: unknown) => datos),
    };
    cuentaRepo = { find: jest.fn(), findOne: jest.fn(), manager };
    sucursalRepo = { find: jest.fn(), findOne: jest.fn() };
    dataSource = {
      transaction: jest.fn((fn: (m: typeof manager) => Promise<unknown>) =>
        fn(manager),
      ),
    };
  });

  describe('listar', () => {
    it('enmascara el apiKey, nunca incluye la secretKey y marca quién usa la cuenta de la empresa', async () => {
      cuentaRepo.find.mockResolvedValue([
        cuenta({ id: 1, sucursalId: null, apiKey: 'EMPRESA-AAAA' }),
        cuenta({ id: 2, sucursalId: 2, apiKey: 'SUCURSAL-BBBB' }),
      ]);
      sucursalRepo.find.mockResolvedValue([
        { id: 1, nombre: 'Centro', activo: true },
        { id: 2, nombre: 'Norte', activo: true },
        { id: 3, nombre: 'Sur', activo: false },
      ]);

      const resultado = await crear().listar(10);

      expect(resultado).toEqual({
        empresa: { configurada: true, apiKeyFinal: 'AAAA' },
        sucursales: [
          {
            sucursalId: 1,
            nombre: 'Centro',
            activa: true,
            cuentaPropia: false,
            apiKeyFinal: null,
            usaCuentaEmpresa: true,
          },
          {
            sucursalId: 2,
            nombre: 'Norte',
            activa: true,
            cuentaPropia: true,
            apiKeyFinal: 'BBBB',
            usaCuentaEmpresa: false,
          },
          {
            sucursalId: 3,
            nombre: 'Sur',
            activa: false,
            cuentaPropia: false,
            apiKeyFinal: null,
            usaCuentaEmpresa: true,
          },
        ],
      });
      expect(JSON.stringify(resultado)).not.toContain('secret');
    });

    it('sin cuenta de empresa, una sucursal sin cuenta propia no tiene cuenta', async () => {
      cuentaRepo.find.mockResolvedValue([]);
      sucursalRepo.find.mockResolvedValue([
        { id: 1, nombre: 'Centro', activo: true },
      ]);

      const resultado = await crear().listar(10);

      expect(resultado.empresa).toEqual({
        configurada: false,
        apiKeyFinal: null,
      });
      expect(resultado.sucursales[0]).toMatchObject({
        cuentaPropia: false,
        usaCuentaEmpresa: false,
      });
    });
  });

  describe('resolver', () => {
    beforeEach(() => {
      sucursalRepo.findOne.mockResolvedValue({ id: 2, empresa: { id: 10 } });
    });

    it('prefiere la cuenta propia de la sucursal', async () => {
      const propia = cuenta({ id: 2, sucursalId: 2 });
      cuentaRepo.find.mockResolvedValue([cuenta({ id: 1 }), propia]);
      await expect(crear().resolver(2)).resolves.toBe(propia);
    });

    it('si no tiene cuenta propia usa la de la empresa', async () => {
      const deEmpresa = cuenta({ id: 1 });
      cuentaRepo.find.mockResolvedValue([deEmpresa]);
      await expect(crear().resolver(2)).resolves.toBe(deEmpresa);
    });

    it('sin cuentas vigentes devuelve null', async () => {
      cuentaRepo.find.mockResolvedValue([]);
      await expect(crear().resolver(2)).resolves.toBeNull();
    });

    it('solo busca cuentas vigentes', async () => {
      cuentaRepo.find.mockResolvedValue([]);
      await crear().resolver(2);
      const { where } = (cuentaRepo.find.mock.calls as unknown[][])[0][0] as {
        where: { fechaBaja: unknown }[];
      };
      for (const condicion of where) {
        expect(condicion.fechaBaja).toMatchObject({ _type: 'isNull' });
      }
    });
  });

  describe('guardar', () => {
    it('da de baja la vigente e inserta una nueva con la secretKey cifrada', async () => {
      const servicio = crear();

      const resumen = await servicio.guardarEmpresa(10, {
        apiKey: 'NUEVA-KEY-9876',
        secretKey: 'super-secreto',
      });

      expect(resumen).toEqual({ configurada: true, apiKeyFinal: '9876' });
      expect(manager.update).toHaveBeenCalledWith(
        CuentaFlow,
        expect.objectContaining({ empresaId: 10 }),
        expect.objectContaining({ fechaBaja: expect.any(Date) as Date }),
      );
      const guardada = (
        manager.create.mock.calls as unknown[][]
      )[0][1] as CuentaFlow;
      expect(guardada.sucursalId).toBeNull();
      expect(guardada.secretKeyCifrada).not.toContain('super-secreto');
      expect(servicio.credenciales(guardada).secretKey).toBe('super-secreto');
    });

    it('sin FLOW_CREDENCIALES_KEY responde 503 y no toca la BD', async () => {
      await expect(
        crear(null).guardarEmpresa(10, { apiKey: 'k', secretKey: 's' }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('la cuenta de una sucursal de otra empresa responde 403', async () => {
      sucursalRepo.findOne.mockResolvedValue({ id: 5, empresa: { id: 99 } });
      await expect(
        crear().guardarSucursal(10, 5, { apiKey: 'k', secretKey: 's' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('una sucursal inexistente responde 404', async () => {
      sucursalRepo.findOne.mockResolvedValue(null);
      await expect(crear().quitarSucursal(10, 5)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('quitar la cuenta propia es una baja lógica', async () => {
      sucursalRepo.findOne.mockResolvedValue({ id: 5, empresa: { id: 10 } });
      await crear().quitarSucursal(10, 5);
      expect(manager.update).toHaveBeenCalledWith(
        CuentaFlow,
        expect.objectContaining({ empresaId: 10, sucursalId: 5 }),
        expect.objectContaining({ fechaBaja: expect.any(Date) as Date }),
      );
    });
  });
});
