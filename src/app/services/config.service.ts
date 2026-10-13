import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { of, Observable, BehaviorSubject } from 'rxjs';
import { ConfigModel } from '../models/config.model';
import { YoutubeCategory } from '../models/youTubeCategory';
import { AppStorageService } from './app-storage.service';



@Injectable({
  providedIn: 'root'
})
export class ConfigService {
  configUrl = 'assets/config.json';
  private configSubject: BehaviorSubject<ConfigModel>;

  constructor(private http: HttpClient,private appStorage:AppStorageService) {
    this.configSubject = new BehaviorSubject<ConfigModel>(null);
  }

  load() {
    // document.body.setAttribute(
    //   'data-theme',
    //    this.appStorage.getSelectedTheme()
    // );
    console.log('start loading config');
    return new Promise<void>((resolve, reject) => {
      this.http.get<ConfigModel>(this.configUrl)
        .toPromise()
        .then(resp => {
          this.configSubject = new BehaviorSubject<ConfigModel>(resp);
          console.log('config loaded', this.configSubject);
          resolve();
        }, reason => reject(reason));
    });
  }

  public get configValue(): ConfigModel {
    return this.configSubject.value;
  }


  }