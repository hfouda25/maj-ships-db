export interface InspectionData {
  id: string;
  date: string;
  inspectorName: string;
  location: string;
  deficienciesFound: number;
  detained: boolean;
  comments: string;
}

export interface ShipData {
  id: string; // UUID or IMO
  name: string;
  imo: string;
  // Particulars
  callSign?: string;
  flag?: string;
  yearBuilt?: string;
  vesselType?: string;
  grossTonnage: number;
  deadweightTonnage?: number;
  
  // Dimensions & Build
  lengthOverall?: string;
  beam?: string;
  draft?: string;
  builder?: string;
  
  // Dynamic Data (Collected via Gemini/Web)
  currentLocation?: string;
  aisStatus?: string;
  classificationSociety?: string;
  classSocietyUrl?: string; // Link to certificate/public register
  sanctionStatus?: string; // e.g., "Clean", "Warning", "Sanctioned"
  sanctionDetails?: string;

  // Survey & Certs
  lastSurveyDate?: string;
  certificateStatus?: string;
  
  // Registration Data
  registrationDate: string;
  inspections: InspectionData[];
}

export interface SearchResult {
  name: string;
  imo: string;
  grossTonnage: number;
  yearBuilt: string;
  type: string;
  flag: string;
  
  // Dimensions
  lengthOverall: string;
  beam: string;
  draft: string;
  builder: string;

  location: string;
  classSociety: string;
  classSocietyUrl: string;
  sanctionInfo: string;
  isSanctioned: boolean;
  
  // Survey info
  lastSurveyDate: string;
  certificateStatus: string;

  description: string;
}

export interface Surveyor {
  id: string;
  name: string;
  location: string;
  email: string;
  phone: string;
  company?: string;
}

export interface PSCPerformance {
  mou: string; // 'Paris MoU', 'Tokyo MoU', 'USCG'
  listStatus: string; // 'White', 'Grey', 'Black', 'Unknown'
  performanceLevel: string; // 'High', 'Medium', 'Low'
}

export interface ClassSocietyData {
  id: string;
  name: string;
  pscData: PSCPerformance[];
  trend: 'Up' | 'Down' | 'Steady';
  trendReason: string;
  lastUpdated: string;
}

export interface User {
  id: string;
  email: string;
  password?: string;
  role: 'admin' | 'user';
  name: string;
  createdAt: string;
}

export type AppView = 'LOGIN' | 'DASHBOARD' | 'REGISTER' | 'DETAILS';