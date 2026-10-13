import { ResponseCode } from "../helpers/enums";

export class ResponseModel {
  public responseTime: Date;
  public reponseCode: ResponseCode;
  public responseMessage: string;
  public dataSet: any;
  constructor() {
    this.responseMessage = "";
    this.responseTime = new Date();
    this.reponseCode = ResponseCode.OK;
  }
}
