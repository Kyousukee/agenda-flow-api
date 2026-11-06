import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { PagosService } from './pagos.service';
import { Pago } from './entities/pago.entity';
import { Reserva } from '../reservas/entities/reserva.entity';
import { Estado } from '../reservas/entities/estado.entity';
import { Sucursal } from '../sucursales/entities/sucursal.entity';

const EMPRESA = 1;
const OTRA = 2;

function montar(duena = OTRA, estado: object | null = { id: 15, tipo: 'Pago', nombre: 'Pagado' }) {
  const sucursal = { id: 10, empresa: { id: duena } };
  const pagoRepo = {
    findOne: jest.fn().mockResolvedValue({ id: 3, reserva: { sucursal } }),
    create: jest.fn((p: object) => p),
    save: jest.fn((p: object) => Promise.resolve(p)),
    createQueryBuilder: jest.fn(),
  };
  const reservaRepo = {
    findOne: jest.fn().mockResolvedValue({ id: 7, sucursal }),
  };
  const estadoRepo = {
    findOne: jest.fn().mockResolvedValue(estado),
    find: jest.fn().mockResolvedValue([
      { id: 14, nombre: 'Pendiente', color: '#f39c12', tipo: 'Pago', orden: 1 },
    ]),
  };
  const sucursalRepo = { findOne: jest.fn().mockResolvedValue(sucursal) };
  const service = new PagosService(
    pagoRepo as unknown as Repository<Pago>,
    reservaRepo as unknown as Repository<Reserva>,
    estadoRepo as unknown as Repository<Estado>,
    sucursalRepo as unknown as Repository<Sucursal>,
  );
  return { service, pagoRepo, estadoRepo };
}

describe('PagosService: aislamiento entre empresas', () => {
  it('no crea pagos en reservas de otra empresa', async () => {
    const { service, pagoRepo } = montar();
    await expect(
      service.create(
        { reservaId: 7, monto: 1, fechaPago: '2030-01-01' },
        EMPRESA,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(pagoRepo.save).not.toHaveBeenCalled();
  });

  it('no cambia el estado de pagos de otra empresa', async () => {
    const { service, pagoRepo } = montar();
    await expect(
      service.actualizarEstado(3, { estadoId: 2 }, EMPRESA),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(pagoRepo.save).not.toHaveBeenCalled();
  });

  it('no lista pagos de otra empresa', async () => {
    const { service, pagoRepo } = montar();
    await expect(service.findAllBySucursal(10, EMPRESA)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(pagoRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('permite operar sobre pagos propios', async () => {
    const { service, pagoRepo } = montar(EMPRESA);
    await service.actualizarEstado(3, { estadoId: 2 }, EMPRESA);
    expect(pagoRepo.save).toHaveBeenCalled();
  });
});

describe('PagosService: estados', () => {
  const pagoNuevo = { reservaId: 7, monto: 1, fechaPago: '2030-01-01' };

  it('registra el pago como Pagado si no se indica estado', async () => {
    const { service, pagoRepo, estadoRepo } = montar(EMPRESA);

    await service.create(pagoNuevo, EMPRESA);

    expect(estadoRepo.findOne).toHaveBeenCalledWith({
      where: { tipo: 'Pago', nombre: 'Pagado' },
    });
    expect(pagoRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        estado: expect.objectContaining({ nombre: 'Pagado' }),
      }),
    );
  });

  it.each(['Reserva', 'Usuario', 'Empresa'])(
    'rechaza crear un pago con un estado de tipo %s',
    async (tipo) => {
      const { service, pagoRepo } = montar(EMPRESA, { id: 1, tipo });

      await expect(
        service.create({ ...pagoNuevo, estadoId: 1 }, EMPRESA),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(pagoRepo.save).not.toHaveBeenCalled();
    },
  );

  it('rechaza cambiar un pago a un estado de otro tipo', async () => {
    const { service, pagoRepo } = montar(EMPRESA, { id: 8, tipo: 'Usuario' });

    await expect(
      service.actualizarEstado(3, { estadoId: 8 }, EMPRESA),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(pagoRepo.save).not.toHaveBeenCalled();
  });

  it('solo expone id, nombre y color del catálogo', async () => {
    const { service, estadoRepo } = montar(EMPRESA);

    const estados = await service.obtenerEstados();

    expect(estadoRepo.find).toHaveBeenCalledWith({
      where: { tipo: 'Pago', activo: true },
      order: { orden: 'ASC' },
    });
    expect(estados).toEqual([{ id: 14, nombre: 'Pendiente', color: '#f39c12' }]);
  });
});
