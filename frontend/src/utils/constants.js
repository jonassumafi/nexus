export const BACKEND_URL = 'http://localhost:3099';

export const EVENTS = {
  SLOT_RESERVED:      'slot_reserved',
  SLOT_WITHDRAWN:     'slot_withdrawn',
  CREW_FILL_UPDATED:  'crew_fill_updated',
  MISSION_FINALIZED:  'mission_finalized',
  MISSION_LAUNCHED:   'mission_launched',
  MISSION_COMPLETE:   'mission_complete',
  MISSION_ABORTED:    'mission_aborted',
  RP_EARNED:          'rp_earned',
  RANK_ADVANCED:      'rank_advanced',
  LOG_SUBMITTED:      'log_submitted',
  LOG_REQUESTED:      'log_requested',
};

export const MISSION_STATUS = {
  WAITING:    'WAITING FOR CREW',
  FINALIZED:  'FINALIZED',
  IN_PROGRESS:'IN PROGRESS',
  COMPLETE:   'COMPLETE',
  ABORT:      'ABORT',
};
