import { ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { PagosService } from './pagos.service';
import { Pago } from './entities/pago.entity';
import { Reserva } from '../reservas/entities/reserva.entity';
import { Estado } from '../reservas/entities/estado.entity';
import { Sucursal } from '../sucursales/entities/sucursal.entity';

const EMPRESA = 1;
const OTRA = 2;

function montar(duena = OTRA) {
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
  const estadoRepo = { findOne: jest.fn().mockResolvedValue({ id: 2 }) };
  const sucursalRepo = { findOne: jest.fn().mockResolvedValue(sucursal) };
  const service = new PagosService(
    pagoRepo as unknown as Repository<Pago>,
    reservaRepo as unknown as Repository<Reserva>,
    estadoRepo as unknown as Repository<Estado>,
    sucursalRepo as unknown as Repository<Sucursal>,
  );
  return { service, pagoRepo };
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
