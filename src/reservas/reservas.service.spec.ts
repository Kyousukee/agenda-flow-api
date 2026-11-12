jest.mock('uuid', () => ({ v4: () => 'uuid-de-prueba' }));

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ReservasService } from './reservas.service';
import { ReservasController } from './reservas.controller';
import { ReservarController } from '../reservar/reservar.controller';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Reserva } from './entities/reserva.entity';
import { Estado } from './entities/estado.entity';
import { Sucursal } from '../sucursales/entities/sucursal.entity';
import { ReservaCorreosService } from '../correos/reserva-correos.service';
import { AbonosService } from '../pagos/abonos.service';
import { Repository } from 'typeorm';

const EMPRESA = 1;
const OTRA = 2;

function montar(reservaEmpresa = EMPRESA, tipoEstado = 'Reserva') {
  const reservaRepo = {
    findOne: jest.fn().mockResolvedValue({
      id: 7,
      estado: { id: 1 },
      sucursal: { empresa: { id: reservaEmpresa } },
    }),
    find: jest.fn().mockResolvedValue([]),
    save: jest.fn((r: object) => Promise.resolve(r)),
  };
  const estadoRepo = {
    findOne: jest.fn().mockResolvedValue({ id: 2, tipo: tipoEstado }),
  };
  const sucursalRepo = {
    findOne: jest
      .fn()
      .mockResolvedValue({ id: 10, empresa: { id: reservaEmpresa } }),
  };
  const correos = { notificarCambioEstado: jest.fn() };
  const abonos = { anularVencidos: jest.fn().mockResolvedValue(0) };
  const service = new ReservasService(
    reservaRepo as unknown as Repository<Reserva>,
    estadoRepo as unknown as Repository<Estado>,
    sucursalRepo as unknown as Repository<Sucursal>,
    correos as unknown as ReservaCorreosService,
    abonos as unknown as AbonosService,
  );
  return { service, reservaRepo, correos };
}

describe('ReservasService', () => {
  it('lista las reservas de una sucursal propia', async () => {
    const { service, reservaRepo } = montar();
    await service.findAllBySucursal(10, EMPRESA);
    expect(reservaRepo.find).toHaveBeenCalled();
  });

  it('no lista reservas de otra empresa', async () => {
    const { service, reservaRepo } = montar(OTRA);
    await expect(service.findAllBySucursal(10, EMPRESA)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(reservaRepo.find).not.toHaveBeenCalled();
  });

  it('cambia el estado de una reserva propia y notifica', async () => {
    const { service, reservaRepo, correos } = montar();
    await service.actualizarEstado(7, { estadoId: 2 }, EMPRESA);
    expect(reservaRepo.save).toHaveBeenCalled();
    expect(correos.notificarCambioEstado).toHaveBeenCalledWith(7);
  });

  it('no cambia el estado de una reserva de otra empresa', async () => {
    const { service, reservaRepo, correos } = montar(OTRA);
    await expect(
      service.actualizarEstado(7, { estadoId: 2 }, EMPRESA),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(reservaRepo.save).not.toHaveBeenCalled();
    expect(correos.notificarCambioEstado).not.toHaveBeenCalled();
  });

  it('rechaza un estado que no es de reserva', async () => {
    const { service, reservaRepo } = montar(EMPRESA, 'Usuario');
    await expect(
      service.actualizarEstado(7, { estadoId: 2 }, EMPRESA),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(reservaRepo.save).not.toHaveBeenCalled();
  });
});

describe('Acceso a las reservas', () => {
  it('el controlador privado exige sesión y rol', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      ReservasController,
    ) as unknown[];
    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
  });

  it('la API pública no expone el listado ni el cambio de estado', () => {
    const metodos = Object.getOwnPropertyNames(ReservarController.prototype);
    expect(metodos).not.toContain('getReservasBySucursal');
    expect(metodos).not.toContain('actualizarEstadoReserva');
  });
});
