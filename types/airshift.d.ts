import type { activities, audiences, cities, indoorActions, travelOptions } from '../public/catalog.mjs';

export type CityId = keyof typeof cities;
export type Audience = keyof typeof audiences;
export type IndoorAction = keyof typeof indoorActions;
export type TravelOption = keyof typeof travelOptions;
export type ScheduleChoice = 'lowest' | 'closer' | 'indoors' | 'defer';

export interface Profile {
  audience: Audience;
  activity: keyof typeof activities;
  fixedTime: string;
  fixedMinutes: number;
  usualTime: string;
  earliest: string;
  latest: string;
  minutes: number;
  sensitive: boolean;
  indoorAvailable: boolean;
  purifier: boolean;
  travel: TravelOption;
  indoorAction: IndoorAction;
  distance: number;
}

export type RoutineDraft = Partial<Omit<Profile, 'audience'>>;
export interface ProfileIssue {
  field: keyof Profile | null;
  message: string;
}

export interface Point {
  time: number;
  pm: number;
  aqi: number;
}

export interface CurrentConditions {
  time: string;
  aqi: number;
  pm: number | null;
  pm10: number | null;
  top: string | null;
}

interface ForecastBase {
  city: CityId | null;
  cityLabel?: string;
  hours: Point[];
  timezone: string;
  current: CurrentConditions | null;
}

export type Forecast =
  | (ForecastBase & { mode: 'sample'; date: null })
  | (ForecastBase & { mode: 'forecast'; date: string; fetchedAt: string });
export type LiveForecast = Extract<Forecast, { mode: 'forecast' }>;

export interface Coordinates {
  lat: number;
  lon: number;
}

export interface ForecastLocation extends Coordinates {
  cacheKey: string;
  city: CityId | null;
  timezone: string;
}

export interface Interval {
  start: number;
  area: number;
  peak: number;
  meanPm: number;
}

export interface Preferences {
  priority: 'exposure' | 'schedule' | 'travel';
  concern: 'unknown' | Exclude<IndoorAction, 'filter'>;
  rail: boolean;
  combine: boolean;
}

export interface RecommendationInput {
  profile: Profile;
  hours: Point[];
  mode: Forecast['mode'];
  preferences: Preferences;
}

interface IntervalSummary {
  start: string;
  end: string;
  peakUsAqi: number;
  outdoorParticleIndex: number;
}

export interface RecommendationContext {
  audience: Audience;
  activity: string;
  sensitive: boolean;
  fixedTime: string;
  preferredTravel: Exclude<TravelOption, 'none'> | null;
  usual: IntervalSummary;
  mode: Forecast['mode'];
  priority: Preferences['priority'];
  indoorConcern: Preferences['concern'];
  schedule: Partial<Record<ScheduleChoice, IntervalSummary | string>>;
  indoor: Partial<Record<IndoorAction, string>>;
  travel: Partial<Record<TravelOption, string>>;
}

export interface Recommendation {
  schedule: ScheduleChoice;
  indoor: IndoorAction;
  travel: TravelOption;
  rationale: string;
}
