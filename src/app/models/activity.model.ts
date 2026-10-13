export interface Activity {
    trackId: string;
    trackName: string;
    duration: number;
    activityType: string;
    nextMediaPlayed: string;
    companyId: number;
    userInformationId: number;
    categoryId: number;
    youTubeVideoId: number,
    points?:number,
  }
  