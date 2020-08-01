import {
  ChangeDetectorRef,
  Component,
  NgZone,
  OnInit,
  TemplateRef,
  ViewChild
} from '@angular/core';

import * as _ from 'lodash';
import { forkJoin as observableForkJoin, Observable, Subscriber } from 'rxjs';

import { RgwUserService } from '../../../shared/api/rgw-user.service';
import { ListWithDetails } from '../../../shared/classes/list-with-details.class';
import { CriticalConfirmationModalComponent } from '../../../shared/components/critical-confirmation-modal/critical-confirmation-modal.component';
import { ActionLabelsI18n } from '../../../shared/constants/app.constants';
import { TableComponent } from '../../../shared/datatable/table/table.component';
import { CellTemplate } from '../../../shared/enum/cell-template.enum';
import { Icons } from '../../../shared/enum/icons.enum';
import { CdTableAction } from '../../../shared/models/cd-table-action';
import { CdTableColumn } from '../../../shared/models/cd-table-column';
import { CdTableFetchDataContext } from '../../../shared/models/cd-table-fetch-data-context';
import { CdTableSelection } from '../../../shared/models/cd-table-selection';
import { Permission } from '../../../shared/models/permissions';
import { AuthStorageService } from '../../../shared/services/auth-storage.service';
import { ModalService } from '../../../shared/services/modal.service';
import { URLBuilderService } from '../../../shared/services/url-builder.service';

const BASE_URL = 'rgw/user';

@Component({
  selector: 'cd-rgw-user-list',
  templateUrl: './rgw-user-list.component.html',
  styleUrls: ['./rgw-user-list.component.scss'],
  providers: [{ provide: URLBuilderService, useValue: new URLBuilderService(BASE_URL) }]
})
export class RgwUserListComponent extends ListWithDetails implements OnInit {
  @ViewChild(TableComponent, { static: true })
  table: TableComponent;
  @ViewChild('userSizeTpl', { static: true })
  userSizeTpl: TemplateRef<any>;
  @ViewChild('userObjectTpl', { static: true })
  userObjectTpl: TemplateRef<any>;
  permission: Permission;
  tableActions: CdTableAction[];
  columns: CdTableColumn[] = [];
  users: object[] = [];
  selection: CdTableSelection = new CdTableSelection();
  isStale = false;
  staleTimeout: number;

  constructor(
    private authStorageService: AuthStorageService,
    private rgwUserService: RgwUserService,
    private modalService: ModalService,
    private urlBuilder: URLBuilderService,
    public actionLabels: ActionLabelsI18n,
    private ngZone: NgZone,
    private changeDetectorRef: ChangeDetectorRef
  ) {
    super();
    this.permission = this.authStorageService.getPermissions().rgw;
    const getUserUri = () =>
      this.selection.first() && `${encodeURIComponent(this.selection.first().uid)}`;
    const addAction: CdTableAction = {
      permission: 'create',
      icon: Icons.add,
      routerLink: () => this.urlBuilder.getCreate(),
      name: this.actionLabels.CREATE,
      canBePrimary: (selection: CdTableSelection) => !selection.hasSelection
    };
    const editAction: CdTableAction = {
      permission: 'update',
      icon: Icons.edit,
      routerLink: () => this.urlBuilder.getEdit(getUserUri()),
      name: this.actionLabels.EDIT
    };
    const deleteAction: CdTableAction = {
      permission: 'delete',
      icon: Icons.destroy,
      click: () => this.deleteAction(),
      disable: () => !this.selection.hasSelection,
      name: this.actionLabels.DELETE,
      canBePrimary: (selection: CdTableSelection) => selection.hasMultiSelection
    };
    this.tableActions = [addAction, editAction, deleteAction];
    this.timeConditionReached();
  }

  ngOnInit() {
    this.columns = [
      {
        name: $localize`Username`,
        prop: 'uid',
        flexGrow: 1
      },
      {
        name: $localize`Full name`,
        prop: 'display_name',
        flexGrow: 1
      },
      {
        name: $localize`Email address`,
        prop: 'email',
        flexGrow: 1
      },
      {
        name: $localize`Suspended`,
        prop: 'suspended',
        flexGrow: 1,
        cellClass: 'text-center',
        cellTransformation: CellTemplate.checkIcon
      },
      {
        name: $localize`Max. buckets`,
        prop: 'max_buckets',
        flexGrow: 1,
        cellTransformation: CellTemplate.map,
        customTemplateConfig: {
          '-1': $localize`Disabled`,
          0: $localize`Unlimited`
        }
      },
      {
        name: $localize`Capacity Limit %`,
        prop: 'size_usage',
        cellTemplate: this.userSizeTpl,
        flexGrow: 0.8
      },
      {
        name: $localize`Object Limit %`,
        prop: 'object_usage',
        cellTemplate: this.userObjectTpl,
        flexGrow: 0.8
      }
    ];
  }

  transformUserData() {
    _.forEach(this.users, (userKey) => {
      const usageList = userKey['usage'];
      const maxSize = userKey['user_quota']['max_size'];
      const maxObjects = userKey['user_quota']['max_objects'];
      let totalSize = 0;
      let numOfObjects = 0;
      _.forEach(usageList, (usageKey) => {
        totalSize = totalSize + usageKey.size_actual;
        numOfObjects = numOfObjects + usageKey.num_objects;
      });
      userKey['user_size'] = totalSize;
      userKey['num_objects'] = numOfObjects;
      userKey['size_usage'] = maxSize > 0 ? totalSize / maxSize : undefined;
      userKey['object_usage'] = maxObjects > 0 ? numOfObjects / maxObjects : undefined;
    });
  }

  timeConditionReached() {
    clearTimeout(this.staleTimeout);
    this.ngZone.runOutsideAngular(() => {
      this.staleTimeout = window.setTimeout(() => {
        this.ngZone.run(() => {
          this.isStale = true;
        });
      }, 10000);
    });
  }

  getUserList(context: CdTableFetchDataContext) {
    this.isStale = false;
    this.timeConditionReached();
    this.rgwUserService.list().subscribe(
      (resp: object[]) => {
        this.users = resp;
        this.transformUserData();
        this.changeDetectorRef.detectChanges();
      },
      () => {
        context.error();
      }
    );
  }

  updateSelection(selection: CdTableSelection) {
    this.selection = selection;
  }

  deleteAction() {
    this.modalService.show(CriticalConfirmationModalComponent, {
      itemDescription: this.selection.hasSingleSelection ? $localize`user` : $localize`users`,
      itemNames: this.selection.selected.map((user: any) => user['uid']),
      submitActionObservable: (): Observable<any> => {
        return new Observable((observer: Subscriber<any>) => {
          // Delete all selected data table rows.
          observableForkJoin(
            this.selection.selected.map((user: any) => {
              return this.rgwUserService.delete(user.uid);
            })
          ).subscribe({
            error: (error) => {
              // Forward the error to the observer.
              observer.error(error);
              // Reload the data table content because some deletions might
              // have been executed successfully in the meanwhile.
              this.table.refreshBtn();
            },
            complete: () => {
              // Notify the observer that we are done.
              observer.complete();
              // Reload the data table content.
              this.table.refreshBtn();
            }
          });
        });
      }
    });
  }
}
