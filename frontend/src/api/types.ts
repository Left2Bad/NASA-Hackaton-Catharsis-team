import type { components } from './schema';

// Short names for contract schemas. The types themselves are generated from contract/openapi.yaml.
type Schemas = components['schemas'];

export type Geometry = Schemas['Geometry'];
export type AreaQuery = Schemas['AreaQuery'];
export type ExportPointsQuery = Schemas['ExportPointsQuery'];
export type Meta = Schemas['Meta'];
export type Preset = Schemas['Preset'];
export type SourceInfo = Schemas['SourceInfo'];
export type CalendarResponse = Schemas['CalendarResponse'];
export type MonthValue = Schemas['MonthValue'];
export type CurrentResponse = Schemas['CurrentResponse'];
export type Warning = Schemas['Warning'];
export type ValidationResponse = Schemas['ValidationResponse'];
export type ErrorResponse = Schemas['ErrorResponse'];
export type ErrorCode = ErrorResponse['error']['code'];
