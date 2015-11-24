#
# Copyright 2015 Red Hat, Inc.
#
# This software is licensed to you under the GNU General Public
# License as published by the Free Software Foundation; either version
# 2 of the License (GPLv2) or (at your option) any later version.
# There is NO WARRANTY for this software, express or implied,
# including the implied warranties of MERCHANTABILITY,
# NON-INFRINGEMENT, or FITNESS FOR A PARTICULAR PURPOSE. You should
# have received a copy of GPLv2 along with this software; if not, see
# http://www.gnu.org/licenses/old-licenses/gpl-2.0.txt.

require 'egon'
require 'fog'

module Actions
  module Fusor
    module Deployment
      module OpenStack
        #Configure a new tenant and new networks on the overcloud
        class OvercloudConfiguration < Actions::Base
          def humanized_name
            _('')
          end

          def plan(deployment)
            plan_self(deployment_id: deployment.id)
          end

          def run
            Rails.logger.debug '====== OvercloudConfiguration run method ======'
            deployment = ::Fusor::Deployment.find(input[:deployment_id])
            overcloud = { :openstack_auth_url  => "http://#{deployment.openstack_overcloud_address}:5000/v2.0/tokens",
                          :openstack_username  => 'admin', :openstack_tenant => 'admin',
                          :openstack_api_key   => deployment.openstack_overcloud_password }

            configure_keystone(deployment, overcloud)
            #####FIX##### Once we ask for networks pass them along and stop using hardcoded values
            configure_networks(deployment, overcloud)
            Rails.logger.debug '=== Leaving OvercloudConfiguration run method ==='
          end

          def overcloud_configuration_completed
            Rails.logger.info 'Overcloud Configuration Completed'
          end

          def overcloud_configuration_failed
            fail _('Overcloud Configuration failed')
          end

          private

          def configure_keystone(deployment, overcloud)
            keystone = Fog::Identity::OpenStack.new(overcloud)
            tenant = keystone.tenants.create(:name => deployment.name)
            #####FIX/TEST, even though we want a new tenant we probably don't need a separate user. Just find admin info
            #####And then make them an admin of the new tenant
            admin_user_id = keystone.list_users.body["users"].find { |u| u["name"] == 'admin' }['id']
            admin_role_id = keystone.list_roles.body["roles"].find { |r| r["name"] == 'admin' }['id']
            keystone.create_user_role(tenant.id, admin_user_id, admin_role_id)
          end

          def configure_networks(deployment, overcloud)
            keystone = Fog::Identity::OpenStack.new(overcloud)
            neutron = Fog::Network::OpenStack.new(overcloud)
            tenant = keystone.get_tenants_by_name(deployment.name).body["tenant"]

            net = neutron.networks.create :name => "#{deployment.name}-net", :tenant_id => tenant['id']
            subnet = neutron.subnets.create :name => "#{deployment.name}-subnet", :network_id => net.id,
                                            :ip_version => 4, :cidr => deployment.openstack_overcloud_private_net,
                                            :tenant_id => tenant['id'], :enable_dhcp => true,
                                            :dns_nameservers => ["#{::Subnet.first.dns_primary}"]

            public_net = neutron.networks.create :name => "#{deployment.name}-float-net", :provider_network_type => 'flat',
                                                 :router_external => true, :provider_physical_network => 'datacentre'
            neutron.subnets.create :name => "#{deployment.name}-float-subnet", :network_id => public_net.id, :enable_dhcp => false,
                                   :ip_version => 4, :cidr => deployment.openstack_overcloud_float_net, :gateway_ip => '192.168.253.254'

            router = neutron.routers.create :name => "#{deployment.name}-router", :tenant_id => tenant['id']
            neutron.add_router_interface router.id, subnet.id
            neutron.update_router router.id, :external_gateway_info => {:network_id => public_net.id}
          end

        end
      end
    end
  end
end
