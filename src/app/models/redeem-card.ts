export class RedeemCard {
    public id: number = 0;
    public heading: string;
    public points: number;
    public imageName: string;
    public shringLink: string;
    public type: string;
    public isChecked: boolean = false;

    constructor(id: number, heading: string = '', points: number = 0, imageName: string = '', sharingLink: string, type: string, isChecked: boolean = false) {
        this.id = id;
        this.heading = heading;
        this.points = points;
        this.imageName = imageName;
        this.isChecked = isChecked;
        this.type = type;
        this.shringLink = sharingLink;
    }
}