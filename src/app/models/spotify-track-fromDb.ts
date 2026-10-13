

export class SpotifyTrackFromDB {
  public id: number;
  public title: string;
  public spotifyId: string;
  public durationInMs: number;
  public companyId: number;
  public watchTimeInPercent: number;
  public playlistId: string;
  public categoryId: number;
  public spotifyInternalId: number;


  constructor() {
    this.id = 0;
    this.durationInMs = 0
    this.title = "";
    this.spotifyId = "";
    this.companyId = 0;
    this.watchTimeInPercent = 0;
    this.playlistId = '';

  }


}