/** One recommended "Try a signal" prompt (dbo.RecommendedSignal). */
export interface RecommendedSignal {
  recommendedSignalId: number;
  signalText: string;
  displayOrder: number;
  /** True when the signal is specific to the signed-in company rather than a global default. */
  isCompanySpecific: boolean;
}

/** A workplace guidance category (dbo.GuidanceCategory) with its recommended signals. */
export interface RecommendedSignalCategory {
  guidanceCategoryId: number;
  /** Matches the workspace tile's data-program value, e.g. "Health & Wellness". */
  category: string;
  subtitle: string | null;
  displayOrder: number;
  signals: RecommendedSignal[];
}

/** Envelope returned by the ListenPay API (ResponseModel<T>). */
export interface ApiResponseModel<T> {
  responseTime: string;
  /** 1 = OK, 2 = Error, 4 = NoDataFound, 401 = Unauthorized */
  responseCode: number;
  responseMessage: string;
  dataSet: T;
}
