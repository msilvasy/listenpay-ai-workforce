import { ResponseCode } from './enums';
import { Constants } from './constants';
import { Injectable } from '@angular/core';
import { HttpInterceptor, HttpRequest, HttpHandler, HttpEvent, HttpSentEvent, HttpHeaderResponse, HttpProgressEvent, HttpResponse, HttpUserEvent, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { AppStorageService } from '../services/app-storage.service';
import { AccountService } from '../services/account.service';
import { ResponseModel } from '../models/response-model';

@Injectable()
export class JwtInterceptor implements HttpInterceptor {
  public constant = Constants;
  constructor(private appStorageService: AppStorageService,private accountService: AccountService,) { }

  intercept(request: HttpRequest<any>, next: HttpHandler):
    Observable<HttpSentEvent | HttpHeaderResponse | HttpProgressEvent | HttpResponse<any> | HttpUserEvent<any> | any> {
      const spotifyAccount = this.accountService.spotifyAccountValue;
    if (request.url.includes('token/refresh') || request.url.includes('assets/config.json')) {
    }
    else  if (!request.url.includes('spotify')) {
      const token = this.appStorageService.getToken();
      if (token) {
        request = request.clone({
          setHeaders: {
            Authorization: "bearer " +token
          }
        });
      }
    }
    else if (spotifyAccount && spotifyAccount.accessToken) {
      request = request.clone({
        setHeaders: {
          Data: `${spotifyAccount.accessToken}`
        }
      });
    }

    return next.handle(request).pipe(map(evt => {
      if (evt instanceof HttpResponse) {
        evt = evt.clone({ body: this.modifyBody(evt) });
      }
      return evt;
    }), catchError((err) => {
      if (err.status === 401) {
        return throwError(ResponseModel);
      } else if (err.status === 0) {
        //internet connectivity issue
        throw err;
      }
      else {
        let responseModel = new ResponseModel();
        responseModel.responseMessage = err.statusText;
        responseModel.reponseCode = err.status;

        return throwError(responseModel);
      }

    }));
  }
  private modifyBody(evt: any) {

    let dataSet: any;
    if (evt.body.responseCode == ResponseCode.OK) {
      dataSet = evt.body.dataSet
    }
    else if (evt.body.responseCode == ResponseCode.Error || evt.body.responseCode == ResponseCode.Unauthorized) {
      throw new HttpErrorResponse({
        status: evt.body.responseCode,
        statusText: evt.body.responseMessage ? evt.body.responseMessage : evt.statusText,
        url: evt.url
      });
    } else {
      dataSet = evt.body;
    }
    return dataSet;
  }
}
