import { Injectable } from '@angular/core';
import { Observable, Subject, BehaviorSubject, throwError } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { AccountModel, AccountModel as ListenPayAccountModel } from '../models/account.model';
import { Router } from '@angular/router';
import { map } from 'rxjs/operators';
import { ConfigService } from './config.service';
import { AppStorageService } from './app-storage.service';

@Injectable({
    providedIn: 'root'
})
export class AccountService {
    public listenPayAccountSubject: BehaviorSubject<AccountModel> = new BehaviorSubject<AccountModel>(new AccountModel());

    private categoryPathKey: string = 'categoryPathKey';
    private categoryTitleKey: string = 'categoryTitleKey';
    private categoryIdKey: string = 'categoryIdKey';

    constructor(private httpClient: HttpClient, private appResourceService: ConfigService,
        private appStorageService: AppStorageService, private router: Router) {
        const currentAccount = this.appStorageService.getAccountInfo;
        this.listenPayAccountSubject.next(currentAccount);

    }

    registerUser(email: string) {
        return this.httpClient.post<AccountModel>(`${this.appResourceService.configValue.listenPayUrl}account/${email}`, {}).pipe(map(res => {
            this.appStorageService.saveUserInformation(res);
            return res;
        }));
    }

    listenPayLogin(email: string) {
        return this.httpClient.post<AccountModel>(`${this.appResourceService.configValue.listenPayUrl}account/auth/${email}`, {}).pipe(map(res => {
            this.appStorageService.saveUserInformation(res);
            const currentAccount = this.appStorageService.getAccountInfo;
            this.listenPayAccountSubject.next(currentAccount);
            // this.getPointsSaveInLocal(res).subscribe((accountInfo) => {
            //   return accountInfo;
            // }, () => {
            //   this.signout();
            // });
            return res;
        }));
    }

    verify2FACode(email: string, code: number) {
        return this.httpClient.post<AccountModel>(`${this.appResourceService.configValue.listenPayUrl}account/Verify2FA`, { Email: email, Code: code }).pipe(map(res => {
            // console.log("verify2FACode res", res);
            if (res.codeVerifyStatus) {
                let accInfo = this.appStorageService.getAccountInfo;
                accInfo.token = res.token;
                accInfo.key = res.key;
                this.appStorageService.saveUserInformation(accInfo);
                const currentAccount = this.appStorageService.getAccountInfo;
                this.listenPayAccountSubject.next(currentAccount);
            }
            return res;
        }));
    }

    addActivity(activity: Activity) {
        const email = this.appStorageService.getAccountInfo.email;
        this.httpClient.post<AccountModel>(`${this.appResourceService.configValue.listenPayUrl}account/${email}/activity`, activity).subscribe(res => {
            this.appStorageService.saveUserInformation(res);
            const currentAccount = this.appStorageService.getAccountInfo;
            this.listenPayAccountSubject.next(currentAccount);
            // this.getPointsSaveInLocal(res).subscribe((accountInfo) => {
            //   return accountInfo;
            // }, () => {
            //   this.signout();
            // });
        });
    }

    //   addUserRedeem(redeemCard:RedeemCard) {
    //     var body = {
    //       UserId: this.appStorageService.getAccountInfo.userInformationId,
    //       Email: this.appStorageService.getAccountInfo.email,
    //       RedeemName: redeemCard.heading,
    //       Points: redeemCard.points,
    //       Amount: redeemCard.points
    //     };

    //     const email = this.appStorageService.getAccountInfo.email;
    //    return this.httpClient.post<AccountModel>(`${this.appResourceService.configValue.listenPayUrl}account/AddUserRedeem`, body).pipe((map((res) => {
    //     const tempAccount = this.appStorageService.getAccountInfo;
    //     tempAccount.earned=res.earned;
    //     this.appStorageService.saveUserInformation(tempAccount);
    //     this.listenPayAccountSubject.next(tempAccount);
    //     })));
    //   }

    // getPointsSaveInLocal(res: AccountModel) {
    //   return this.youtubeVideoService.getAllCategoriesPoints(this.appStorageService.companyId, this.appStorageService.userInformationId).pipe(map(points => {
    //     res.earned = points.toFixed();
    //     this.appStorageService.saveUserInformation(res);
    //     const currentAccount = this.appStorageService.getAccountInfo;
    //     this.listenPayAccountSubject.next(currentAccount);
    //     return currentAccount;
    //   }));
    // }


    //  spotifyLogin(redirectPath:string,categoryTitle:string, categoryId:number) {
    //    this.appStorageService.saveValue(this.categoryPathKey, redirectPath);
    //    this.appStorageService.saveValue(this.categoryTitleKey, categoryTitle);
    //    this.appStorageService.saveValue(this.categoryIdKey, categoryId.toString());

    //     const config = this.appResourceService.configValue;
    //     // tslint:disable-next-line:max-line-length

    //    const url = `${config.spotifyAuthUrl}/authorize?response_type=code&client_id=${config.spotifyClientId}&scope=${config.spotifyScope}&redirect_uri=${config.redirectPopupUrl}`;
    //    let handle = window.open(url, 'winname', 'directories=no,titlebar=no,toolbar=no,location=no,status=no,menubar=no,scrollbars=no,resizable=no,width=600,height=450');
    //    if (!handle) {
    //      window.location.href = `${config.spotifyAuthUrl}/authorize?response_type=code&client_id=${config.spotifyClientId}&scope=${config.spotifyScope}&redirect_uri=${config.redirectUrl}`;
    //    }
    //  }
    //   finishSpotifyLogin(accessToken, refreshToken, scope, expiresIn, popup) {

    //     const user = new SpotifyAccount();
    //     user.accessToken = accessToken;
    //     user.refreshToken = refreshToken;
    //     user.scope = scope;
    //     user.expiresIn = new Date(new Date().getTime() + expiresIn * 1000);
    //     localStorage.setItem(Constants.SPOTIFY_ACCOUNT_KEY, JSON.stringify(user));
    //     this.spotifyAccountSubject.next(user);
    //      this.appStorageService.saveValue(Constants.SPOTIFY_LOGIN_COMPLETE,'true');
    //      let redirectPath=this.appStorageService.getValue(this.categoryPathKey);
    //      let catgoryTitle=this.appStorageService.getValue(this.categoryTitleKey);
    //      let categoryId=this.appStorageService.getValue(this.categoryIdKey);

    //     if (popup) {
    //       window.close();
    //     } else {
    //       this.router.navigate([redirectPath], { queryParams: { selectedCategoryTitle: catgoryTitle, selectedCategoryId: categoryId, selectedMedia: 2 } });
    //     }

    //   }
    //   refreshSpotifyToken() {
    //     return this.httpClient.post<any>(
    //       `${this.appResourceService.configValue.listenPayUrl}spotify/token/refresh/${this.spotifyAccountValue.refreshToken}`,
    //       {}).pipe(map(result => {
    //         this.spotifyAccountSubject.value.accessToken = result.access_token;
    //         this.spotifyAccountSubject.value.expiresIn = new Date(new Date().getTime() + result.expires_in * 1000);
    //         this.spotifyAccountSubject.value.scope = result.scope;
    //         localStorage.setItem(Constants.SPOTIFY_ACCOUNT_KEY, JSON.stringify(this.spotifyAccountSubject.value));
    //       }));
    //   }

    //   public get spotifyAccountValue(): SpotifyAccount {
    //     return this.spotifyAccountSubject.value;
    //   }

    signout() {
        localStorage.clear();
        this.listenPayAccountSubject.next(new AccountModel());
        this.router.navigate(['/login'], { queryParams: { redirect: this.router.url } });
    }
}
