import type { components } from './schema';

// Короткие имена для схем контракта. Сами типы генерируются из contract/openapi.yaml.
type Schemas = components['schemas'];

export type Geometry = Schemas['Geometry'];
export type AreaQuery = Schemas['AreaQuery'];
export type Meta = Schemas['Meta'];
export type Preset = Schemas['Preset'];
export type SourceInfo = Schemas['SourceInfo'];
export type CalendarResponse = Schemas['CalendarResponse'];
export type MonthValue = Schemas['MonthValue'];
export type CurrentResponse = Schemas['CurrentResponse'];
export type Warning = Schemas['Warning'];
export type ErrorResponse = Schemas['ErrorResponse'];
export type ErrorCode = ErrorResponse['error']['code'];
