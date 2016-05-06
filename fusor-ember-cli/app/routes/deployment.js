import Ember from 'ember';
import DeploymentRouteMixin from '../mixins/deployment-route-mixin';
import UsesOseDefaults from '../mixins/uses-ose-defaults';
import request from 'ic-ajax';

export default Ember.Route.extend(DeploymentRouteMixin, UsesOseDefaults, {

  model(params) {
    return this.store.findRecord('deployment', params.deployment_id);
  },

  setupController(controller, model) {
    controller.set('model', model);
    controller.set('satelliteTabRouteName', 'satellite.index');
    controller.set('lifecycleEnvironmentTabRouteName', 'configure-environment');
    controller.set('model.host_naming_scheme', 'Freeform');
    controller.set('confirmRhevRootPassword', model.get('rhev_root_password'));
    controller.set('confirmRhevEngineAdminPassword', model.get('rhev_engine_admin_password'));
    controller.set('confirmCfmeRootPassword', model.get('cfme_root_password'));
    controller.set('confirmCfmeAdminPassword', model.get('cfme_admin_password'));
    controller.set('confirmOvercloudPassword', model.get('openstack_overcloud_password'));

    this.loadOpenshiftDefaults(controller, model);
    this.loadCloudFormsDefaults(controller, model);
    this.loadDefaultDomainName(controller);

    // copied from setupController in app/routes/subscriptions/credentials.js
    // to fix bug of Review Tab being disabled on refresh and needing to click
    // on subscriptions to enable it
    // check if org has upstream UUID using Katello V2 API
    var orgID = model.get('organization.id');
    var url = '/katello/api/v2/organizations/' + orgID;
    Ember.$.getJSON(url).then(function(results) {
      if (Ember.isPresent(results.owner_details.upstreamConsumer)) {
        controller.set('organizationUpstreamConsumerUUID', results.owner_details.upstreamConsumer.uuid);
        controller.set('organizationUpstreamConsumerName', results.owner_details.upstreamConsumer.name);
        // if no UUID for deployment, assign it from org UUID
        if (Ember.isBlank(controller.get('model.upstream_consumer_uuid'))) {
          controller.set('model.upstream_consumer_uuid', results.owner_details.upstreamConsumer.uuid);
          controller.set('model.upstream_consumer_name', results.owner_details.upstreamConsumer.name);
        }
      } else {
        controller.set('organizationUpstreamConsumerUUID', null);
        controller.set('organizationUpstreamConsumerName', null);
      }
    });

  },

  loadDefaultDomainName(controller) {
    this.store.findAll('hostgroup').then(function(hostgroups) {
      return hostgroups.filterBy('name', 'Fusor Base').get('firstObject')
      .get('domain.name');
    }).then(domainName => controller.set('defaultDomainName', domainName));
  },

  loadCloudFormsDefaults(controller, model) {
    // GET from API v2 CFME settings for Foreman/Sat6 - if CFME is selected
    if (model.get('deploy_cfme')) {
      request('/api/v2/settings?search=cloudforms').then(function(settings) {
        var results = settings['results'];
        // overwrite values for deployment since Sat6 settings is only place to change CFME VM requirements
        model.set('cloudforms_vcpu', results.findBy('name', 'cloudforms_vcpu').value);
        model.set('cloudforms_ram', results.findBy('name', 'cloudforms_ram').value);
        model.set('cloudforms_vm_disk_size', results.findBy('name', 'cloudforms_vm_disk_size').value);
        model.set('cloudforms_db_disk_size', results.findBy('name', 'cloudforms_db_disk_size').value);
      });
    }
  },

  loadOpenshiftDefaults(controller, model) {
    // GET from API v2 OSE settings for Foreman/Sat6

    if (model.get('deploy_openshift')) {
      request('/api/v2/settings?search=openshift').then(settings => {
        var results = settings['results'];
        if (this.shouldUseOseDefault(model.get('openshift_master_vcpu'))) {
          model.set('openshift_master_vcpu', results.findBy('name', 'openshift_master_vcpu').value);
        }
        if (this.shouldUseOseDefault(model.get('openshift_master_ram'))) {
          model.set('openshift_master_ram', results.findBy('name', 'openshift_master_ram').value);
        }
        if (this.shouldUseOseDefault(model.get('openshift_master_disk'))) {
          model.set('openshift_master_disk', results.findBy('name', 'openshift_master_disk').value);
        }
        if (this.shouldUseOseDefault(model.get('openshift_node_vcpu'))) {
          model.set('openshift_node_vcpu', results.findBy('name', 'openshift_node_vcpu').value);
        }
        if (this.shouldUseOseDefault(model.get('openshift_node_ram'))) {
          model.set('openshift_node_ram', results.findBy('name', 'openshift_node_ram').value);
        }
        if (this.shouldUseOseDefault(model.get('openshift_node_disk'))) {
          model.set('openshift_node_disk', results.findBy('name', 'openshift_node_disk').value);
        }
      });

      // set default values 1 Master, 1 Worker, 30GB storage for OSE
      if (this.shouldUseOseDefault(model.get('openshift_number_master_nodes'))) {
        model.set('openshift_number_master_nodes', 1);
      }
      if (this.shouldUseOseDefault(model.get('openshift_number_worker_nodes'))) {
        model.set('openshift_number_worker_nodes', 1);
      }
      if (this.shouldUseOseDefault(model.get('openshift_storage_size'))) {
        model.set('openshift_storage_size', 30);
      }

    }
  },

  actions: {
    installDeployment() {
      var self = this;
      var deployment = self.modelFor('deployment');
      var token = Ember.$('meta[name="csrf-token"]').attr('content');

      var controller = this.controllerFor('review/installation');

      if(controller.get('modalOpen')) {
          controller.closeContinueDeployModal();
      }

      controller.set('spinnerTextMessage', 'Building task list');
      controller.set('showSpinner', true);

      request({
        url: '/fusor/api/v21/deployments/' + deployment.get('id') + '/deploy',
        type: "PUT",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "X-CSRF-Token": token,
          "Authorization": "Basic " + self.get('session.basicAuthToken')
        }
      }).then(
        function (response) {
          var uuid = response.id;
          console.log('task uuid is ' + uuid);
          deployment.set('foreman_task_uuid', uuid);
          deployment.save().then(
            function () {
              controller.set('showSpinner', false);
              return self.transitionTo('review.progress.overview');
            },
            function () {
              controller.set('showSpinner', false);
              controller.set('errorMsg', 'Error in saving UUID of deployment task.');
              controller.set('showErrorMessage', true);
            });
        },
        function (response) {
          controller.set('showSpinner', false);

          if (response.jqXHR.status === 422 && response.jqXHR.responseJSON && response.jqXHR.responseJSON.errors) {
            // rails is sending back validation errors as a 422 with an errors hash that looks like
            // errors: {field => [error_messages]}
            let validationErrors = [];
            let errors = response.jqXHR.responseJSON.errors;
            let addValidationError = (error) => validationErrors.push(error);

            for (var prop in errors) {
              if (errors.hasOwnProperty(prop)) {
                errors[prop].forEach(addValidationError);
              }
            }
            controller.set('validationErrors', validationErrors);
          } else {
            controller.set('errorMsg', response.jqXHR.responseText);
            controller.set('showErrorMessage', true);
          }
        });
    },

    attachSubscriptions() {
      var self = this;
      var token = Ember.$('meta[name="csrf-token"]').attr('content');
      var sessionPortal = this.modelFor('subscriptions');
      var consumerUUID = sessionPortal.get('consumerUUID');
      var subscriptionPools = this.controllerFor('subscriptions/select-subscriptions').get('subscriptionPools');

      var controller = this.controllerFor('review/installation');

      controller.set('buttonDeployDisabled', true);
      controller.set('spinnerTextMessage', 'Attaching Subscriptions in Red Hat Customer Portal');
      controller.set('showSpinner', true);

      subscriptionPools.forEach(function(item){
        console.log(item);
        console.log('qtyToAttach is');
        console.log(item.get('qtyToAttach'));
        console.log('pool ID is');
        console.log(item.get('id'));
        console.log('isSelectedSubscription is');
        console.log(item.get('isSelectedSubscription'));

        if (item.get('qtyToAttach') > 0) {

          // POST /customer_portal/consumers/#{CONSUMER['uuid']}/entitlements?pool=#{POOL['id']}&quantity=#{QUANTITY}
          var url = '/customer_portal/consumers/' + consumerUUID + "/entitlements?pool=" + item.get('id') + "&quantity=" + item.get('qtyToAttach');
          console.log('POST attach subscriptions using following URL');
          console.log(url);

          request({
              url: url,
              type: "POST",
              headers: {
                  "Accept": "application/json",
                  "Content-Type": "application/json",
                  "X-CSRF-Token": token
              }
              }).then(function(response) {
                  console.log('successfully attached ' + item.qtyToAttach + ' subscription for pool ' + item.id);
                  self.send('installDeployment');
              }, function(error) {
                  console.log('error on attachSubscriptions');
                  return self.send('error');
              }
          );

        }
      });
    },

    saveAndCancelDeployment() {
      return this.send('saveDeployment', 'deployments');
    },

    cancelAndDeleteDeployment() {
      var deployment = this.get('controller.model');
      var self = this;
      deployment.destroyRecord().then(function() {
        return self.transitionTo('deployments');
      });
    },

    error(reason) {
      console.log(reason);
      var controller = this.controllerFor('deployment');

      if (typeof reason === 'string') {
        controller.set('errorMsg', reason);
      } else if (reason && typeof reason === 'object') {
        if (reason.responseJSON && reason.responseJSON.error && reason.responseJSON.error.message) {
          controller.set('errorMsg', reason.responseJSON.error.message);
        } else if (reason.responseText) {
          controller.set('errorMsg', reason.responseText);
        }
      }
    },

    refreshModel() {
      console.log('refreshModelOnDeploymentRoute');
      return this.refresh();
    }
  }
});
