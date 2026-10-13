export class ThemeModel {
    public id: number = 0;
    public name: string;
    public title: string;
    public bgPrimary: string;
    public isSelected: boolean = false;


    constructor(id: number, themeName: string = '',  themeTitle: string = '', bgPrimary: string = "") {
        this.id = id;
        this.name = themeName;
        this.title = themeTitle;
        this.bgPrimary = bgPrimary;

    }
}