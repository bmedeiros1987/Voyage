import test from 'node:test';
import assert from 'node:assert/strict';
import { extractProviderTravelFacts } from '../src/travel-provider-parsers.mjs';
import { ingestTravelAttachmentBuffer } from '../src/attachment-ingest.mjs';

test('LATAM itinerary learns PNR and flight segment structure without personal fixtures', () => {
  const text = `VIAGEM PARA BRASILIA, BRAZIL\nCÓDIGO DA RESERVA ZXCVBN\nLATAM AIRLINES\nGROUP\nLA 3737\nOperado por: LATAM AIRLINES BRASIL\nFLN\nFLORIANOPOLIS, BRAZIL\nBSB\nBRASILIA, BRAZIL\nPartindo às (hora local): 14:40\nChegando às (hora local): 16:55\nCabine: Econômica`;
  const result = extractProviderTravelFacts(text, { fileName: 'itinerary.pdf' });
  assert.equal(result.provider, 'LATAM');
  assert.equal(result.category, 'AIR_TRAVEL');
  assert.equal(result.facts.confirmationCode, 'ZXCVBN');
  assert.equal(result.items[0].flightNumber, '3737');
  assert.equal(result.items[0].origin, 'FLN');
  assert.equal(result.items[0].destination, 'BSB');
});

test('ClickBus BP-e learns boarding, route, seat, localizer and fare while ignoring duplicate legal section', () => {
  const text = `Via do Passageiro\nDOCUMENTO AUXILIAR DE BILHETE DE PASSAGEM ELETRÔNICO\nViação: Reunidas Classe: SEMI DIRETO\nOrigem: FLORIANOPOLIS, SC\nDestino: BALNEARIO CAMBORIU, SC\nEmbarque: 03/04/2026, às 04:50 Partida: 03/04/2026, às 05:20\nPoltrona: 14\nLocalizador: QWERTY\nValor Total R$ 45,16\nVia do Motorista\nOrigem: FLORIANOPOLIS, SC\nDestino: BALNEARIO CAMBORIU, SC`;
  const result = extractProviderTravelFacts(text);
  assert.equal(result.provider, 'CLICKBUS');
  assert.equal(result.category, 'BUS');
  assert.equal(result.facts.confirmationCode, 'QWERTY');
  assert.equal(result.facts.seat, '14');
  assert.equal(result.facts.currency, 'BRL');
});

test('Civitatis voucher learns activity, pickup and cancellation semantics', () => {
  const text = `Civitatis\nRESERVA / ID ABC20479\nDATA / DATE Sábado 30 dezembro/26\nHORA / HOUR 14:00 h\nPESSOAS / PAX 2\nIDIOMA / LANGUAGE Português\nVALORTOTAL / PRICE: R$519,40\nPonto de recolha: Hotel Central\nCondições de cancelamento: cancelamento gratuito até 28 de dezembro.\nRESERVA DE ATIVIDADE / BOOKING DETAILS\nVisita guiada por Punta del Este\nDADOS DO CLIENTE / GUEST DETAILS`;
  const result = extractProviderTravelFacts(text);
  assert.equal(result.provider, 'CIVITATIS');
  assert.equal(result.category, 'TOUR');
  assert.equal(result.facts.confirmationCode, 'ABC20479');
  assert.equal(result.facts.pax, 2);
  assert.match(result.facts.pickupPoint, /Hotel Central/i);
});

test('Localiza rental parser extracts operational rental facts but not identity/payment data', () => {
  const text = `LOCALIZA RENT A CAR S/A\nVeículo: XYZ0000 Logan Expression\nGrupo Reservado: C - Economico Com Ar\nGrupo Utilizado: F - Intermediario\nGrupo Cobrado: C - Economico Com Ar\nSaída / Vigência Seguro: 23/11/2026 09:44 Agencia Aeroporto Km: 4037 Tanque: 8/8\nRetorno / Vigência Seguro: 26/11/2026 07:22 Agencia Aeroporto Km: 4371 Tanque: 8/8\nUtilização: 2 Diárias 21 Horas 38 Minutos\nKm: Livre Reserva: AB123XYZ\nTOTAL GERAL 299,71\nContrato de Aluguel de Carros/Proposta de Seguro N° FLNA999999\nCPF 000.000.000-00 Mastercard 000000******0000`;
  const result = extractProviderTravelFacts(text);
  assert.equal(result.provider, 'LOCALIZA');
  assert.equal(result.category, 'CAR_RENTAL');
  assert.equal(result.facts.contractNumber, 'FLNA999999');
  assert.equal(result.facts.confirmationCode, 'AB123XYZ');
  assert.equal(result.facts.mileagePolicy, 'UNLIMITED');
  assert.equal('cpf' in result.facts, false);
  assert.equal('paymentCard' in result.facts, false);
  assert.ok(result.warnings.includes('SENSITIVE_BILLING_AND_IDENTITY_FIELDS_INTENTIONALLY_NOT_EXTRACTED'));
});

test('multi-page Ticketwork-style voucher yields multiple ticket items', () => {
  const text = `Não compre de terceiros\nCCBB Centro Cultural Banco do Brasil\nExposição - Exemplo\nCódigo do ingresso: TICKETAAA\nSetor: DIA 19/03 - 18h às 20h\nValor: R$ 0,00\nLocal do evento: CCBB - Brasília - DF\nNão compre de terceiros\nCCBB Centro Cultural Banco do Brasil\nExposição - Exemplo\nCódigo do ingresso: TICKETBBB\nSetor: DIA 19/03 - 18h às 20h\nValor: R$ 0,00\nLocal do evento: CCBB - Brasília - DF`;
  const result = extractProviderTravelFacts(text);
  assert.equal(result.provider, 'TICKETWORK');
  assert.equal(result.category, 'EVENT_TICKET');
  assert.equal(result.items.length, 2);
  assert.equal(result.facts.ticketCount, 2);
});

test('myIDTravel ICS is detected by content and filename even when MIME is text/html', () => {
  const ics = `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nSUMMARY:G31271:FLN - CGH\nLOCATION:Filekey:QWERTY\nDTSTART:20260620T091000\nDTEND:20260620T102500\nX-ALT-DESC;FMTTYPE=text/html: Código de reserva QWERTY G31271 20.06.2026 FLN 09:10 CGH 10:25 ZED - R2 Standby LISTADO\nEND:VEVENT\nEND:VCALENDAR`;
  const result = ingestTravelAttachmentBuffer(Buffer.from(ics), { fileName: 'MyIDTravelFlight1.ics', mimeType: 'text/html' });
  assert.equal(result.document.detectedFormat, 'ICALENDAR');
  assert.equal(result.facts.provider, 'MYIDTRAVEL');
  assert.equal(result.facts.confirmationCode, 'QWERTY');
  assert.equal(result.items[0].origin, 'FLN');
  assert.equal(result.items[0].destination, 'CGH');
});

test('Booking email body differentiates confirmation, modification and cancellation', () => {
  const confirmed = extractProviderTravelFacts('Booking.com Sua reserva no Hotel Exemplo está confirmada. Número de confirmação: 123456789');
  const cancelled = extractProviderTravelFacts('Booking.com Reserva cancelada com sucesso. Número de confirmação: 123456789');
  assert.equal(confirmed.provider, 'BOOKING_COM');
  assert.equal(confirmed.status, 'CONFIRMED');
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(cancelled.facts.confirmationCode, '123456789');
});
