const OFFICIAL = Object.freeze({
  servicePage: 'https://www.gov.br/pt-br/servicos/obter-o-certificado-internacional-de-vacinacao-e-profilaxia',
  meuSusDigital: 'https://meususdigital.saude.gov.br/',
  anvisaCivp: 'https://www.gov.br/anvisa/pt-br/assuntos/paf/certificado-internacional-de-vacinacao',
  fallbackRequest: 'https://solicitacao2.servicos.gov.br/person-service+civp+693989d96ff2d82bbaa673a6?forceAuth=true',
  requestStatus: 'https://servicos.acesso.gov.br/consultarservicossolicitados'
});

export function civpGuidanceCapabilities() {
  return {
    version: '1.0',
    jurisdiction: 'BR',
    supportedCertificates: ['ICVP_YELLOW_FEVER'],
    lastOfficialReview: '2026-09-07',
    principles: [
      'Use official Brazilian government channels only.',
      'Check Meu SUS Digital first; use the federal request flow when the certificate is not available there.',
      'A yellow-fever ICVP is travel-valid starting 10 days after vaccination and remains valid for life when properly issued.',
      'Do not treat a vaccination record alone as the international certificate when the destination specifically requires an ICVP.',
      'Do not advise vaccination when medical eligibility is uncertain; direct the traveller to an authorized health professional.',
      'Before travel, re-check the destination and every transit country because certificate requirements may change.'
    ],
    officialLinks: OFFICIAL
  };
}

export function buildBrazilCivpGuide(input = {}) {
  const vaccine = token(input.vaccine || 'YELLOW_FEVER');
  const vaccinated = triState(input.vaccinated);
  const certificateAvailableInMeuSus = triState(input.certificateAvailableInMeuSus);
  const vaccinationDate = safeDate(input.vaccinationDate || input.administeredAt);
  const departureDate = safeDate(input.departureDate || input.arrivalDate || input.travelDate);
  const doseFractionated = input.doseFractionated === true;
  const medicallyEligible = triState(input.medicallyEligible);

  if (vaccine !== 'YELLOW_FEVER') {
    return {
      version: '1.0',
      status: 'SPECIAL_CASE',
      certificate: 'ICVP',
      vaccine,
      message: 'No fluxo brasileiro, CIVP para meningite e poliomielite é excepcional e exige orientação específica da autoridade sanitária. Use o canal oficial da Anvisa/Ministério da Saúde para o caso concreto.',
      action: 'OPEN_OFFICIAL_CIVP_SERVICE',
      officialLinks: OFFICIAL,
      lastOfficialReview: '2026-09-07'
    };
  }

  if (medicallyEligible === false) {
    return result('CLINICIAN_REVIEW', 'Antes de qualquer vacinação, procure avaliação profissional. Se houver contraindicação, verifique com a autoridade sanitária e o país de destino se existe possibilidade de dispensa médica.', 'SEEK_CLINICIAN_AND_WAIVER_GUIDANCE');
  }

  if (vaccinated === false) {
    return result('VACCINATION_NEEDED_OR_REVIEW', 'A vacina de febre amarela não foi confirmada. Se ela for exigida para sua rota, procure um serviço de vacinação com antecedência suficiente e confirme sua elegibilidade médica.', 'FIND_AUTHORIZED_VACCINATION_GUIDANCE');
  }

  if (doseFractionated) {
    return result('DOSE_REVIEW_REQUIRED', 'O registro informado indica dose fracionada. Para emissão do CIVP de febre amarela, a Anvisa informa que a dose fracionada não é aceita. Confirme o esquema adequado com um serviço de saúde.', 'REVIEW_YELLOW_FEVER_DOSE_WITH_HEALTH_SERVICE');
  }

  const validity = vaccinationDate ? addDays(vaccinationDate, 10) : null;
  const timingBlocked = validity && departureDate && validity > departureDate;
  if (timingBlocked) {
    return {
      ...result('NOT_VALID_BY_TRAVEL_DATE', `A vacinação foi informada, mas o CIVP só passa a ter validade internacional 10 dias depois da dose. Pela data fornecida, ele ainda não estará válido na data da viagem.`, 'REVIEW_TRAVEL_TIMING_AND_ENTRY_RULE'),
      validFrom: validity.toISOString().slice(0, 10)
    };
  }

  if (certificateAvailableInMeuSus === true) {
    return {
      ...result('READY_TO_DOWNLOAD', 'O CIVP está disponível no Meu SUS Digital. Abra Minha Saúde → Vacinas, localize a opção de Certificado Internacional de Vacinação, baixe o documento e mantenha uma cópia offline para a viagem.', 'OPEN_MEU_SUS_DIGITAL'),
      steps: [
        'Acesse o Meu SUS Digital pelo aplicativo ou portal oficial.',
        'Entre com sua conta Gov.br.',
        'Na tela inicial, abra Minha Saúde e depois Vacinas.',
        'Localize o Certificado Internacional de Vacinação/Profilaxia referente à febre amarela.',
        'Baixe o certificado e salve uma cópia offline no Voyage; imprima se desejar uma cópia física.'
      ]
    };
  }

  if (certificateAvailableInMeuSus === false) {
    return {
      ...result('REQUEST_ON_GOV_BR', 'O CIVP não está disponível no Meu SUS Digital. Use o serviço oficial do Gov.br para solicitar a emissão.', 'OPEN_GOV_BR_CIVP_REQUEST'),
      steps: [
        'Separe CPF e um comprovante de vacinação legível.',
        'O comprovante deve mostrar nome e data de nascimento, vacina de febre amarela, data e lote, assinatura do profissional e identificação/carimbo da unidade de saúde.',
        'Abra o serviço oficial Tirar o Certificado Internacional de Vacinação e inicie a solicitação com sua conta Gov.br.',
        'Envie o comprovante solicitado e acompanhe a análise em Minhas solicitações.',
        'Quando deferido, baixe o CIVP, confira seus dados e guarde uma cópia offline para a viagem.'
      ],
      requiredProofFields: ['NAME', 'DATE_OF_BIRTH', 'YELLOW_FEVER_VACCINE', 'VACCINATION_DATE', 'VACCINE_BATCH', 'PROFESSIONAL_SIGNATURE', 'HEALTH_UNIT_IDENTIFICATION']
    };
  }

  return {
    ...result('CHECK_MEU_SUS_FIRST', 'Primeiro verifique se o CIVP já está disponível no Meu SUS Digital. Se não estiver, o Voyage pode orientar o pedido pelo Gov.br.', 'CHECK_MEU_SUS_DIGITAL_FOR_ICVP'),
    steps: [
      'Acesse o Meu SUS Digital e abra Minha Saúde → Vacinas.',
      'Procure a opção de Certificado Internacional de Vacinação/Profilaxia.',
      'Se o certificado não aparecer, use o fluxo oficial de solicitação do Gov.br.'
    ]
  };

  function result(status, message, action) {
    return {
      version: '1.0',
      status,
      certificate: 'ICVP',
      vaccine: 'YELLOW_FEVER',
      message,
      action,
      vaccinationDate: vaccinationDate ? vaccinationDate.toISOString().slice(0, 10) : null,
      validFrom: validity ? validity.toISOString().slice(0, 10) : null,
      validity: 'LIFETIME_AFTER_VALID_FROM',
      officialLinks: OFFICIAL,
      lastOfficialReview: '2026-09-07',
      medicalAdvice: false,
      itineraryMutation: false
    };
  }
}

function triState(value) {
  return value === true ? true : value === false ? false : null;
}

function token(value) {
  const text = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return text || null;
}

function safeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(date, days) {
  if (!date) return null;
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}
