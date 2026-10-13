import { YoutubeCategory } from './youTubeCategory';

export class YouTubeVideo {
  public id: number;
  public title: string;
  public videoId: string;
  public description: string;
  public userId: number;
  public thumbnailURL: string;
  public videoURL: string;
  public dateCreated:string;
  public watchTimeStatus: number;
  public relatedCategories: YoutubeCategory[];
  constructor() {
    this.id = 0;
    this.userId = 0
    this.title = "";
    this.videoId = "";
    this.description = "";
    this.thumbnailURL = "";
    this.videoURL = "";
    this.watchTimeStatus = 0;
  }


}



